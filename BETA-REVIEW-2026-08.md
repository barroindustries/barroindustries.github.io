# Beta review — August 2026

A whole-codebase review across 22 lenses produced **215 findings**. The 66 rated
high-impact were then put through adversarial verification: each got **three
independent refuters** with different lenses — one checking the code really says
what was claimed, one checking a real user can reach it, one checking the harm
actually follows — followed by an adjudicator that re-read the decisive files
rather than counting votes. Refuters were instructed to default to REFUTED when
uncertain, so a finding had to earn survival.

**Result: 63 stand, 3 refuted, 0 unresolved.**

> Findings are grouped by severity, then tagged MONEY (changes a posted peso
> amount or a ledger entry) and SECURITY (access control, privilege, data exposure).

---

## At a glance

| | Count |
|---|---|
| High | 20 |
| Medium | 33 |
| Low | 10 |
| **Money-affecting** | 18 |
| **Security** | 12 |

---

## HIGH (20)

### F01 — Editing a ledger row from the Ledger tab writes the doc directly with no finance_rollup delta, so Finance Overview's Total Income / Total Expenses KPIs stay permanently wrong until a President runs the rebuild

`MONEY`

**What is true**

Confirmed by my own read of the code; all three lenses stand and none refuted it. js/screens/finance.js:1413 routes the Ledger-tab Edit button to window.financeEditModal({collection:'ledger'}) with date/type/amount/category editable and onSaved:redo, where redo (:1401) is a pure re-render. financeEditModal's save handler (:180) is a bare `db.collection(collection).doc(docId).update(upd)` followed only by closeModal/toast/onSaved — no Ledger.upsertByRef, no _syncRollup, not even dbCacheInvalidate('finance_rollup'). Meanwhile Finance Overview's headline KPIs are derived exclusively from finance_rollup (:2115 dbCachedGet, :2122-2123 reduce, :2146 render), and the "totals need a rebuild" banner is gated on `!rollups.length` (:2130) so a wrong-but-nonzero rollup never trips it. I grepped every _syncRollup caller: only js/finance-ledger.js post/postMulti/upsertByRef (:346,:395-396,:454), the delete cascades in js/departments.js (:566/569,:2317,:3987) and js/screens/hr.js:1067. functions/index.js has no ledger trigger, there is no onSnapshot on ledger/finance_rollup, and rebuildRollups is president-only (js/finance-ledger.js:623-625) — so the drift really is unbounded for the finding's scenario (a manually-created ledger row has no source doc to trigger a resync). Reach is real: firestore.rules:1512 allows the update for canFinance() (president/manager/finance/Finance-dept), the same tier that reads Overview. The sibling expense edit at :2183 already does the right thing (`resyncLedgerForSource('expenses', e.id).then(redo)`), so this is an omission, not a design choice; js/finance-ledger.js:97-115 also claims to cover "every mutation path that changes a ledger row's money fields" and omits it. Two corrections to the finding's scope, neither fatal. (1) It is not just amount: changing `date` across a month boundary leaves the amount in the OLD month's rollup doc and never adds it to the new one, and flipping `type` credit<->debit leaves the amount in `income` while the ledger says `expense` — a 2x-amount net-income error, worse than the amount-only case the finding describes. (2) The blast radius is narrower than "the two screens disagree" implies: finance_rollup's only real consumer is Overview's three KPI cards — Reports (loadFinStatement, :517), Balance Sheet, Cash Flow, Bank Rec and Break-even all re-read the raw ledger, and the ledger itself (the source of truth) is written correctly. So this is a stale derived aggregate on the headline card, not ledger corruption — which is why I rate it high rather than critical. The general_journal branch at :1405 is equally unhooked but is NOT part of this defect: rebuildRollups scans db.collection('ledger') only (js/finance-ledger.js:627), so GJ rows are outside finance_rollup entirely.

**Fix**

Primary fix — add a rollup-aware edit path in js/finance-ledger.js and route the Ledger tab through it, rather than patching the call site (the in-memory row `e` can be stale relative to Firestore, so the pre-image must be read inside the function). In js/finance-ledger.js, next to upsertByRef, add:

  async function editRow(docId, patch) {
    var ref = db.collection('ledger').doc(docId);
    var before = await ref.get();
    if (!before.exists) throw new Error('Ledger.editRow: row not found');
    var oldRow = before.data();
    await ref.update(patch);
    var after = await ref.get();
    await _syncRollup(oldRow, -1);
    if (after.exists) await _syncRollup(after.data(), +1);
    if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('finance_rollup'); dbCacheInvalidate('ledger'); }
  }

Export it on the window.Ledger object (js/finance-ledger.js:675-677, alongside rebuildRollups/_syncRollup) and add it to the coverage comment at js/finance-ledger.js:97-115 so the "every mutation path" list is true again. Mirror the existing _syncRollup ordering convention used by upsertByRef (:395-396): old at -1 first, new at +1 second, both best-effort (they never throw).

Then in js/screens/finance.js renderLedgerTab (:1413), give the ledger branch a real onSaved instead of bare `redo`. Two options, either is fine:
  (a) minimal — keep financeEditModal and chain the sync:
      onSaved: () => { window.Ledger.editRowResync(e.id).then(redo); }
      where editRowResync(docId) reads the row and does _syncRollup(oldSnapshotCapturedBeforeOpen, -1) + _syncRollup(newRow, +1); this requires capturing the pre-image at modal-open time, which is the stale-read risk noted above.
  (b) preferred — add an optional `saveFn` hook to window.financeEditModal (js/screens/finance.js:139/:180) so the save becomes `await (saveFn ? saveFn(upd) : db.collection(collection).doc(docId).update(upd));`, then pass `saveFn: upd => window.Ledger.editRow(e.id, upd)` from the ledger branch at :1413. This keeps the write and the rollup delta in one place and lets the other raw-update call sites adopt it later.

Leave the general_journal branch (:1405) on the plain update — GJ rows are not in finance_rollup.

Secondary hardening (separate, smaller): make the Overview staleness check detect disagreement, not just emptiness. At js/screens/finance.js:2129-2133, in addition to `!rollups.length`, compare `rollups.reduce((s,r)=>s+(r.count||0),0)` against a cheap ledger count (or stamp a `rollupDirty:true` flag on finance_rollup whenever a _syncRollup call throws) and show the existing banner + '—' placeholders when they diverge, so any future unhooked write path degrades loudly instead of silently.

### F06 — The Approvals screen has no role gate at the route or the render function, and is deep-linked from decision notifications sent to ordinary staff — exposing colleagues' CA-deduction amounts/reasons, partner quote totals + client names, and the company-wide late-arrival and task-review queues to any authenticated non-partner

`SECURITY`

**What is true**

CONFIRMED by my own read of the tree, with the leak set narrower than the finding's headline implies.

Mechanism verified verbatim:
- js/app.js:2399 `case 'approvals':        renderApprovals(currentUser); break;` — I read navigateTo end-to-end (js/app.js:2321-2434). There is no role/allow-list check anywhere before or inside the switch. The contrast is in the same switch: `case 'product-database'`, `case 'audit-log'` (isPresident()) and `case 'system-health'` (isPresident()||finance) each inline an Access-Denied empty-state. `approvals` does not.
- js/screens/approvals.js:85 `window.renderApprovals = async function(currentUser) {` → :86 `const c = deptContainer();` → straight into APPROVAL_CAPS (:99-116). No early return. The role is used only for per-button capability flags (canActOn/canAct/canDelete, :117-120) and for the banner at :210.
- The card body renders `${escHtml(item.name)}` (:393) and `${escHtml(item.detail)}` (:398) unconditionally; the `canActOn(item.type) ?` ternary begins at :402 — it gates the buttons, not the data.
- Reach is real and effortless, not hash-typing-only: js/notifications.js `} else if (link && typeof navigateTo === 'function') { navigateTo(link); }` (:169-170), plus a dedicated `type === 'approval_result'` → navigateTo('approvals') branch just above it. Requester-facing decision notices carrying link:'approvals' go to non-admin uids at js/svc-approvals.js:92,104 (payroll delete result → requester), :121,132 (finance delete result → reqBy, the Accountant, role `finance`), :162,172,181,191 (quote/client delete result → ctx.by), mirrored at js/screens/approvals.js:665,673,683,691 (btn.dataset.by ← `data-by="${item.deleteRequestedBy}"`, :429), and js/departments.js:1701,1717 (raise-request result → the finance/HR filer). `deleteRequestedBy` is set to the requester by the "Request Delete" button that js/screens/sales.js:1776-1777 renders for everyone who is NOT `canDeleteDirect` (:1746 = president|owner|manager) — i.e. every internal sales agent/employee.

CORRECTIONS I am adopting from the refuters (both checks reproduce on my read):

1. Four of the finding's evidence line numbers are wrong or misattributed, though none is the mechanism. departments.js:609/644 are actually :613/:649 and are `Notifs.sendToOwner(...)` — request-filed pings to the President, not decision notices to a requester. departments.js:3473 is not a notification at all (the client-delete notify is :3597, also sendToOwner). sales.js:1902 is :1912 and is likewise sendToOwner. The requester-facing links that make this reachable are the svc-approvals.js / approvals.js / departments.js:1701,1717 sites listed above. Also minor: APPROVAL_CAPS spans :101-116, not :103-119.

2. The leak set is narrower than "the whole approvals queue". Firestore rules are not filters: every unconstrained `.where(...)` whose read rule is data- or role-dependent is rejected wholesale and silently swallowed by its own `.catch(...=>{docs:[]})`, so those rows never paint for an employee. Verified denied: cash_advances (firestore.rules:457-459 `resource.data.userId == request.auth.uid || isFinanceOrAdmin()`), leave_requests (:1781-1783, same shape), pending_raises (:846-848 `resource.data.subjectId == ... || isFinanceOrAdmin()`), bk_quotes (:1005-1009 `!isPartner() && (createdBy==uid || isAdmin() || ...)`), plus submissions / signup_requests / payroll_delete_requests / finance_delete_requests / purchase_requisitions. So the salary rows (`₱old → ₱new`, approvals.js:365) and leave reasons do NOT leak — the finding did not claim them, but the headline could be read that way.

   Verified permitted for any authenticated non-partner, and therefore actually rendered: approval_requests (firestore.rules:1043 `allow read: if isAuth() && !isPartner();`) → both the `ca_deduct` rows ("Juan Dela Cruz · CA Deduction Request · ₱3,000.00 this month — <reason>", approvals.js:357) and the `bs_quote` rows ("BSQ-0142 — Acme Corp · <agent> · ₱1,250,000.00", :356); attendance_extensions (:443) → who was late and on what date; tasks where status=='review' (:502 — the `!isPartner()` disjunct short-circuits true, so the query passes) → every task in review company-wide plus assignee names; clients with deleteRequested (:1997); bs_quotes with deleteRequested (:986 — same `|| !isPartner()` short-circuit). I'd add one item the finding missed: the History chip (approvals.js:828, :1260) does `approval_requests.orderBy('createdAt','desc').limit(150)`, so 30 days of already-decided CA deductions leak too, not just pending ones.

3. Scope caveat neither the finding nor the title stated: for role `partner` all five permitted reads deny, so the page renders empty for them. The exposed population is internal non-admins — employee, agent, finance, and (by design, view-only) secretary.

4. The UI is the last line here, not the only line. firestore.rules deliberately grants those five collections to all internal staff, so the same rows are readable through the SDK regardless of this screen. That means gating the route alone hardens the product surface but does not make the data confidential; the rules need narrowing too if the CA amounts are genuinely meant to be President/Manager-tier.

Not refuted, and I did not follow any refuter down: all three reached STANDS and each of their corrections independently reproduced on my read. Severity is high rather than critical because the write path is not escalated (action buttons are absent for non-admins via canActOn, and the money-tier collections deny at the rules layer), and the most sensitive money — salaries/raises, cash advances, leave — does not render.

**Fix**

Three edits; 1 and 2 are the actual fix, 3 removes the delivery vector, 4 is the durable one.

1. Gate the route. js/app.js:2399, inside navigateTo's switch. Replace
     case 'approvals':        renderApprovals(currentUser); break;
   with the exact pattern the sibling cases at :2423-2425 already use:
     case 'approvals':        (isPresident() || currentRole==='manager' || currentRole==='secretary') ? renderApprovals(currentUser) : (c.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🔒',44)}</div><h4>Access Denied</h4></div>`, window.lucide && lucide.createIcons({ nodes: [c] })); break;
   That predicate is exactly `_navVariant()`'s 'admin' bucket (js/app.js:1341-1343), which is already the only variant whose nav exposes page:'approvals' (js/config.js:498 sidebar.admin, :565 bottom.admin) — so no currently-working navigation changes. Consider extracting it as `window.canSeeApprovals()` in app.js next to isPresident() so the render function and the notification router can share one definition.

2. Defense in depth inside the screen. js/screens/approvals.js, in window.renderApprovals immediately after `const c = deptContainer();` (:85-86), before the 14-collection Promise.all at :139:
     if (!(window.canSeeApprovals ? canSeeApprovals() : ['president','manager','secretary'].includes(window.currentRole||''))) {
       c.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🔒',44)}</div><h4>Access Denied</h4></div>`;
       if (window.lucide) lucide.createIcons({ nodes: [c] });
       return;
     }
   navigateTo is the only caller today (grepped: js/app.js:2399 is the sole call site), but the early return also stops the 14 Firestore queries from firing for a user who will see nothing, and stops the misleading "Oversight view. You can review every request here" banner at :210 from ever being shown to a plain employee.

3. Stop deep-linking ordinary staff into an admin screen. Every notice below is addressed to the REQUESTER, who is by construction not an approver — after edit 1 the link lands them on Access Denied, so drop `link: 'approvals'` from the payload (the title/body already carry the whole outcome) or repoint it at the originating screen ('bk-quotations' / 'bs-quotations' / 'personal-finance'):
   - js/svc-approvals.js:92, :104 (payrollDeleteApprove/Deny), :121, :132 (financeDeleteApprove/Deny → reqBy), :162, :172 (deleteQuoteApprove/Deny → ctx.by), :181, :191 (deleteClientApprove/Deny → ctx.by)
   - js/screens/approvals.js:665, :673, :683, :691 (same four, via btn.dataset.by)
   - js/departments.js:1701, :1717 (raise_request result → the finance/HR filer)
   Leave the request-FILED pings alone — js/departments.js:613, :649, :1624, :3597, js/screens/sales.js:1912, js/screens/dashboards.js:2714, :2934, js/screens/hr.js:1142, js/screens/production.js:2788, js/app.js:4662, js/screens/people.js:2239 are Notifs.sendToOwner(...) to the President, where link:'approvals' is correct. Also check the `else if (type === 'approval_result') navigateTo('approvals')` branch in js/notifications.js (~:163, just above the generic `link` branch at :169): its only sender is the secretary-escalation at js/screens/approvals.js:128, which goes to the owner, so it is safe once the route is gated — but it should not be widened.

4. Narrow the rules, or accept that this stays SDK-readable. firestore.rules:1043 `match /approval_requests/{docId} { allow read: if isAuth() && !isPartner();` is what actually makes the money rows readable. Tightening to `isAuth() && (isFinanceOrAdmin() || resource.data.get('userId','') == request.auth.uid || resource.data.get('agentId','') == request.auth.uid)` is the right shape (use .get(field,default) per the missing-field-throws memory), but it makes the collection data-dependent, so every unconstrained reader must be audited first and given a matching where-clause or an admin-only guard: js/screens/dashboards.js:942, :1188, :1327, :2879, js/config.js:2697, js/screens/approvals.js:148, :335, :828, :1260, js/app.js:1924, :4782, js/screens/sales.js:1951, :1965, :2059. Same consideration for attendance_extensions (firestore.rules:443; readers at js/screens/dashboards.js:944, :1195, :1329, js/screens/hr.js:2705, js/screens/people.js:1233, js/app.js:2492). Ship 1-3 first — they are self-contained and low-risk; treat 4 as a separate change with `firebase deploy --only firestore:rules` and a re-diff beforehand.

Per CLAUDE.md, any JS edit here needs the version/CACHE_VER bump, which the .git/hooks/pre-commit hook does automatically — do not hand-edit it.

### F11 — Marketing → Budgeting "Log Expense / Income" posts to the shared ledger with no in-flight guard and no deterministic id — a double-tap creates two ledger rows and double-increments finance_rollup

`MONEY`

**What is true**

STANDS, with two scope corrections and one stale-evidence correction. I read the handler myself rather than counting the three STANDS votes.

What is true: the `save-exp-btn` click handler inside `renderBudgeting` (js/departments.js:3966-4017 in my read) never touches `disabled` or any re-entrancy flag anywhere in its body. It awaits `window.assertPeriodOpen(expDate)` (js/config.js, a Firestore-backed read) before writing, then calls `await db.collection('ledger').add(_deptExpRow)` (js/departments.js:3999) — an auto-id write with no dedupe — and then hand-rolls `await window.Ledger._syncRollup(_deptExpRow, +1)` (js/departments.js:4002). `_syncRollup` (js/finance-ledger.js:283-311) is purely additive inside a transaction (`expense: (data.expense||0) + sign*delta.expense`, `count: (data.count||0) + sign`), so a second run genuinely double-counts. The button stays live and hit-testable across both awaits, so a second tap re-enters and repeats the whole sequence.

This path deliberately bypasses the idempotency the rest of the finance layer has: `Ledger.post` (js/finance-ledger.js:319-347) mints a deterministic doc id from `entry.ref`, writes inside `db.runTransaction` returning `{existed:true}` on a repeat, and only calls `_syncRollup` when `!result.existed`. The repo already recognises this exact hazard elsewhere — js/departments.js:3300 in Record Sale reads `saveBtn.disabled=true; // guard against double-click double-posting`. The omission here is an inconsistency with the codebase's own convention, not a design choice.

Not self-correcting: `rebuildRollups` (js/finance-ledger.js:627-638) re-derives totals by scanning the ledger, so it re-confirms the duplicate as authoritative rather than repairing it. `renderBudgeting` re-sums raw ledger rows for "Total Spent"/"Remaining" (js/departments.js:3816, 3832), so the doubled figure shows in the UI as truth. Correcting it needs a manual finance delete, which itself requires President approval per the `financeDelete` flow.

Nothing upstream blocks it: `openPage` (js/app.js:3692) never disables footer buttons, and a repo-wide grep for `preventDoubleSubmit|withBusy|dataset.busy|data-busy|btn-busy|_saving|inflight` across js/ returns zero hits. firestore.rules `allow create` on `ledger` gates date format, period-close, bankFlow shape and role — nothing per-document-unique — so an identical second create succeeds.

Corrections I am making to the finding as written:
1. Line numbers are stale (~+130) and still drifting under concurrent edits — anchor on the `save-exp-btn` string, not a line number. The handler is at js/departments.js:3966, the `.add()` at 3999, the `_syncRollup` at 4002; `assertPeriodOpen` is js/config.js:~2122, not 2044.
2. Blast radius is narrower than "departmental": `renderBudgeting` has exactly ONE call site — js/departments.js:991, Marketing only. No other department reaches this poster.
3. The actor is not "a department head" generally. The Log Expense button renders only under `canSeeSpend` (js/departments.js:3810 = president/owner/manager/finance), and firestore.rules independently denies non-`canFinance()` creates. That is precisely who operates this screen, so the defect is live for its real users.
4. The finding's DETAIL truncates mid-sentence at "The mechanism was reproduced end-t" — no reproduction is actually documented. I am upholding this on static code alone, which is sufficient here.

No lens refuted it, and none of the three was refuting on grounds I disagree with after reading the code. Severity high: silent, persistent, un-self-correcting overstatement of a peso figure in the company's shared ledger. Mitigating only that it needs an accidental double-tap and leaves two adjacent identical rows in the visible Expense/Income log plus two success toasts — weak, easily-missed hints, not an error path.

**Fix**

Two edits in js/departments.js, inside `renderBudgeting` (the `log-expense-btn` → `save-exp-btn` block).

1. Immediate, minimal (matches the existing convention at js/departments.js:3300):
In the `save-exp-btn` handler, capture the button first and disable it after the cheap synchronous validation but BEFORE the first `await`, wrapping everything in try/finally so failure paths restore it:

  const saveBtn = document.getElementById('save-exp-btn');
  saveBtn.addEventListener('click', async () => {
    ...existing sync validation (desc/amount) — these `return` before any await, leave the button enabled...
    saveBtn.disabled = true; // guard against double-click double-posting
    try {
      try { await window.assertPeriodOpen(expDate); } catch (e) { return; }
      ...build _deptExpRow, write, sync rollup, notify...
      closeModal(); Notifs.success(...); renderBudgeting(...);
    } catch (ex) {
      Notifs.showToast('Failed: ' + (ex.message || ex.code), 'error');
    } finally {
      if (document.body.contains(saveBtn)) saveBtn.disabled = false;
    }
  });

Note the current handler has no try/catch at all around the ledger write, so a rules rejection today throws an unhandled rejection with the modal still open and no toast — the finally/catch fixes that too.

2. Durable fix (do this as well; `disabled` cannot cover retry/multi-device/offline-replay):
Route the write through `window.Ledger.post` instead of the raw `.add()` + hand-rolled `_syncRollup` pair. Mint a deterministic ref ONCE when the modal is opened (a closure const, so re-submits reuse it), e.g.

  const _expRef = `DEPTEXP-${dept}-${currentUser.uid}-${Date.now()}`;

then replace js/departments.js:3999-4002 with

  await window.Ledger.post({ ref: _expRef, ...entryFieldsMappedForLedgerPost });

and DELETE the manual `if (window.Ledger && typeof window.Ledger._syncRollup === 'function') await window.Ledger._syncRollup(_deptExpRow, +1);` line — `Ledger.post` already calls `_syncRollup(row, +1)` exactly once and only when `!result.existed` (js/finance-ledger.js:346). Verify `_mapEntry` in js/finance-ledger.js carries the dept-specific fields this row needs (`dept`, `budgetLineId`, `budgetLineName`, `source`, and the `window.readVatField('exp-vat', amount)` spread); extend `_mapEntry` or pass them through if it drops any, otherwise the Budgeting UI's `e.budgetLineId` filter (js/departments.js:3827) and the dept `where('dept','==',dept)` query (js/departments.js:3816) will stop matching.

3. Same-file adjacent: `save-bg-btn` (js/departments.js:3915) has the identical shape — no disable, direct `db.collection(collection).add()` — so a double-tap duplicates a budget line. Apply the same `disabled = true` guard there.

Bump `CACHE_VER` / let the pre-commit hook bump `APP_VERSION` per CLAUDE.md, since this is a JS edit.

### F22 — Delete-approval idempotency guard is a non-atomic read-then-write (TOCTOU) that fails open on a cache-stale read — a second president session double-applies FieldValue.increment() cash-advance restores

`MONEY`

**What is true**

STANDS, with the mechanism re-diagnosed. I confirmed every cited line in the tree. `financeDeleteApprove` (js/svc-approvals.js:113-115), `payrollDeleteApprove` (:79-80) and the duplicate handler in js/screens/hr.js:1162-1164 all do `await ...doc(id).get().catch(()=>null)` then `if (snap && snap.exists && snap.data().status !== 'pending') return {already:true}` — a plain read, no transaction, no `source:'server'` pin, and the write it guards (`window.financeExecuteDelete`) is committed in a SEPARATE batch that the server has no way to tie back to the request's state. The staged writes are non-idempotent server-side transforms with no precondition: js/departments.js:519-522 `cash_advances/{caId}.balance: increment(cd.amount)` (+ `status:'approved'`, `paidAt: delete()`) and :528 `worker_profiles/{workerId}.caBalance: increment(ca)`. Nothing downstream can heal it — `financeExecuteDelete`'s co-staged `batch.delete()` of an already-deleted doc is a permitted no-op (firestore.rules:1599 / :877 / cash_advances :484 carry no `resource.data` predicate and no status/idempotency constraint), and js/config.js:2690 `cas.reduce((s,a)=>s+(a.balance||0),0)` treats the stored balance as authoritative, feeding it straight into the next payroll deduction (:2699-2705, whose `payments[].month` check only blocks a repeat in the SAME month). Result: a ₱12,000 CA at ₱2,000/mo restored twice reads as ₱14,000 owing and silently over-collects ₱2,000.

CORRECTIONS TO THE FINDING (all three lenses converged on the same narrowing, and I agree after reading it):
1. The "read ERROR" arm is largely self-defusing and should be dropped as the headline. If `finance_delete_requests.get()` rejects, `financeDeleteCascade`'s own read (js/departments.js:489, `try { ... } catch(_) {}` → `if (!d) return []` at :490) rejects for the same reason and stages ZERO increments; the batch then carries only an idempotent `batch.delete`. (It does still leave a real second-order bug — see the fix — because a swallowed read error lets `financeExecuteDelete` commit a bare delete with the ledger/CA cascade silently skipped.)
2. The exploitable path needs BOTH the request doc AND the source doc (`salary_history`/`payslips`) to resolve stale-successfully, which means a SECOND Firestore client. A single device double-clicking is guarded — `btn.disabled = true` (approvals.js:608/627/941/959, hr.js:1160) plus Firestore latency compensation applying the queued mutation to that client's own cache.
3. But the finding UNDER-states one vector: this is not offline-only. Two president clients both ONLINE, both clicking approve within the round-trip window, both read `status:'pending'` and both read the source doc as existing, so both commit increments. IndexedDB persistence (js/firebase-config.js:77-78) doesn't create the defect — it widens the window from ~1 second to days, because a stream-dropped desktop tab keeps serving a stale `pending` card and a stale source doc, and its batch is durably queued and replays on reconnect. `isRealPresident()` (js/modules.js:43-45) is role-based, not email-locked, so "two president clients" is one person with a phone plus a stale office tab, or two accounts. Reach is confirmed live: js/app.js:2399 `case 'approvals'` → approvals.js:112-113 `'finance-req'/'finance-del': ['president']` → the `.fr-approve-btn`/`.fdel-approve-btn` handlers, plus the second entry point at js/screens/hr.js:1153-1177 which renders the very `salary_history` docs whose stale copies do the damage.
Impact "high" is right; "traced" confidence is right; the offline-sw lens label is right only as an amplifier, not as the root cause.

**Fix**

Make the claim atomic with the money write, and stop trusting cached reads on the money path. Three edits, in priority order.

1. PRIMARY — put the request-status flip in the SAME batch as the cascade, and add a server-side precondition so a replayed stale batch is rejected wholesale.
   - js/departments.js:548 — extend the signature: `window.financeExecuteDelete = async function(collection, docId, claim)` where `claim = { ref, expectStatus:'pending', set:{ status:'approved', resolvedBy, resolvedAt } }`. Before `await batch.commit()` (:560) add `if (claim) batch.update(claim.ref, claim.set);`. Because a Firestore WriteBatch is atomic, if the rules reject that one update the whole batch — including both `increment()` calls — is rejected. This is the only fix that is correct while offline: the batch queues normally, and on replay the server rejects it instead of double-applying.
   - firestore.rules:1596-1600 (`finance_delete_requests`) and :874-878 (`payroll_delete_requests`) — split the update rule so a resolve transition requires the doc to still be pending: `allow update: if isAuth() && isPresident() && (resource.data.get('status','pending') == 'pending' || request.resource.data.get('status','') == resource.data.get('status',''));` (use `.get(field, default)` — a bare missing-field read denies the rule; see the repo's known footgun). Deploy with `firebase deploy --only firestore:rules` — `git push` does NOT ship rules.
   - js/svc-approvals.js:113-118 (`financeDeleteApprove`) and :79-86 (`payrollDeleteApprove`) — delete the `.get().catch(()=>null)` pre-check and the trailing standalone `db.collection(...).doc(id).update({status:'approved',...})`; pass the claim through instead: `await window.financeExecuteDelete(coll, docId, { ref: db.collection('finance_delete_requests').doc(id), set:{ status:'approved', resolvedBy: currentUser.uid, resolvedAt: firebase.firestore.FieldValue.serverTimestamp() } })`. Catch `permission-denied` from `batch.commit()` and return `{ already: true }` so the existing `if (r.already) Notifs.showToast('Already handled.')` UX (approvals.js:610/629/945/962) still fires — it currently only fires when the broken guard works.
   - js/screens/hr.js:1162-1167 — same rewrite; this duplicate handler must not be left behind, it is the client most likely to hold the stale `salary_history` doc.

2. SECONDARY — stop the cascade reading phantom docs, and stop it half-applying on a read failure. js/departments.js:488-490, currently:
     `let d = null; try { const s = await db.collection(collection).doc(docId).get(); d = s.exists ? s.data() : null; } catch(_) {} if (!d) return [];`
   Change to pin the read to the server and let failure ABORT the delete rather than silently skipping the cascade:
     `const s = await db.collection(collection).doc(docId).get({ source: 'server' }); if (!s.exists) throw new Error('Source record no longer exists — nothing to delete.'); const d = s.data();`
   The `{source:'server'}` pin makes an offline read throw instead of resolving a stale phantom (same technique already used in js/screens/worker.js `_resolveActiveRecord`, referenced by the comment at js/firebase-config.js:74-76). Removing the swallow also fixes the independent half-apply bug where a transient read error let `financeExecuteDelete` commit a bare `batch.delete` with the ledger row and CA restore silently skipped. `onClickSafe` (js/departments.js:31-39) already surfaces the throw as a toast; hr.js:1153's plain `addEventListener` needs a try/catch added around the call so the president sees the failure instead of a dead button.

3. DEFENSE IN DEPTH — clamp the transform. js/departments.js:519-522: `balance: increment(cd.amount)` can exceed the original principal. There is no Firestore-native clamp, so either move that one write into a `db.runTransaction` that reads `amount`/`balance` and writes `Math.min(balance + cd.amount, amount)`, or add a rules guard on `cash_advances` update (firestore.rules:484) rejecting `request.resource.data.get('balance',0) > resource.data.get('amount',0)`. This bounds the blast radius of any future non-idempotent replay on this path.

Also bump `window.APP_VERSION` via the normal commit hook (do not hand-edit) so the SW ships the JS changes.

### F25 — recordAttendancePunch stamps serverVerified:true (green "Server-verified" badge in HR) on a geofence computed entirely from client-supplied lat/lng, with a selfie check that only proves an object exists — an active Type-B worker can book a paid on-site shift from anywhere

`MONEY` `SECURITY`

**What is true**

Verified in the current tree; all three lenses hold on the load-bearing mechanics. functions/index.js:1746-1748 reads lat/lng/accuracy straight off the callable payload and feeds them to serverSiteMatch at :1804 with only range sanity (|lat|<=90, 0<accuracy<=GEO_ACCURACY_FLOOR_M=100 at :1568), so hand-typed site coordinates with accuracy:18 pass the geofence. The selfie gate (:1769 parseOwnSelfiePath, :1774 bucket().file().exists()) proves only that some object exists under attendance-selfies/{own uid}/ — my own grep for timeCreated/getMetadata/nonce over functions/index.js returns zero hits, and the epoch the client embeds in the filename (js/screens/worker.js:904) is never parsed. The record is then written with inValid/outValid:true (:1915/:1932) and serverVerified:true (:2010) in the single merge set at :2001-2012, and js/screens/hr.js:3092 _hrVerifiedBadge renders that as a green "✅ Server-verified / Confirmed server-side" chip (used at :3152, :4230, :4261). No App Check exists anywhere — my grep for appCheck/enforceAppCheck/rawRequest/recaptcha across functions/index.js, js/, index.html and firebase.json returned nothing — so the callable at :1686 is reachable from any HTTP client holding a worker ID token; the repo's own OFFLINE-PUNCH-SPEC.md:228 documents that console invocation as a test step. firestore.rules:411-421 deliberately makes this callable the SOLE writer of the pay fields, so rules are not a second line of defense here.

Three corrections to the write-up, none of which sink it. (1) The badge is at js/screens/hr.js:3092, not 2887. (2) The "recycled weeks-old selfie" is NOT the load-bearing weakness — storage.rules:133-137 lets the same worker create a brand-new valid image under their own path from anywhere, so a freshness check alone would not stop the fraud. What the missing freshness/binding actually costs is HR's last human check: the thumbnail HR eyeballs in the audit panel need not be from this punch at all. The single load-bearing defect is that POSITION is client-asserted while the product labels the result "Confirmed server-side". (3) "Any caller" and "every peso of Type-B pay" are both too broad: :1786-1795 requires an active worker_profiles doc with linkedUid==uid and :1799-1802 requires a configured active geo_site, so the actor is exactly an active production worker; and hr.js:4101-4102 excludes days from the auto-sum only when needsReview===true or hoursWorked>16 — both duration-based. A forged 07:00→16:00 punch returns needsReview:false, auto-fills the payslip time cells at hr.js:4106-4110 with source 'kiosk-verified', and is paid via rph×hrs at :4287. So exposure is per forged day (~₱500/day at a ₱500 daily rate, ~₱3k per forged week per worker) plus the >4h food allowance, not the whole payroll.

I am also naming the part no code edit can close: a browser has no attestable position source, so a server can never independently observe where the device is. That makes the honest-labeling half of the fix mandatory rather than optional — the current green badge converts an unverifiable claim into a signal HR is told to stop questioning, and the header comment at functions/index.js:1505-1563 overclaims by promising this closes the "Fake-GPS app" hole. The other four promises in that header (server-recomputed haversine, accuracy floor, server-derived Manila date, server-timestamp hoursWorked) are genuinely delivered.

**Fix**

Two required halves — honest labeling (nothing can fully fix client-asserted GPS) plus compensating detection. All in functions/index.js `recordAttendancePunch` and js/screens/hr.js.

1. Stop over-asserting (functions/index.js, the targetRef.set at :2001-2012). Replace the bare `serverVerified: true` with structured provenance the UI can render truthfully, e.g. `verification: { geofenceRecomputed: true, positionSource: 'client-asserted', selfie: 'exists-only', appCheck: false, attested: false }`, keeping `serverVerified: true` only as a legacy alias so old records still render. Rewrite the header block at :1505-1563: the "could therefore assert an on-site, valid-looking shift from anywhere" hole is narrowed (verdict, date and hours are now server-owned) but NOT closed for position.

2. Retitle the badge (js/screens/hr.js `_hrVerifiedBadge`, :3092). Green "✅ Server-verified" / "Confirmed server-side" must become something like blue/neutral "Geofence checked (server)" with title "Server recomputed the distance from the position the device reported. The position itself cannot be independently verified — check the selfie and distance." Reserve a green chip for records that additionally pass the checks in 3–4 below.

3. Bind the selfie to this invocation (functions/index.js, replace the exists() call at :1774). Use `const [md] = await admin.storage().bucket().file(objectPath).getMetadata();` and require `Date.now() - Date.parse(md.timeCreated) <= 10*60*1000` (skip/relax for the queuedReplay branch, which already forces needsReview). Also reject reuse: before writing, query the worker's recent records under `attendance_worker/{profileId}/records` for an existing `inSelfieUrl`/`outSelfieUrl` equal to `selfieUrl` and throw if found. Fail closed, matching the existing selfie policy. This restores HR's visual review as a real check.

4. Add server-side plausibility/audit signals before the write (functions/index.js, just after the serverSiteMatch block at :1804-1810), setting `needsReview = true` rather than throwing, so HR triages instead of workers being locked out:
   - Velocity: load the previous punch's lat/lng/inAt|outAt for this profileId and flag if implied speed exceeds ~120 km/h.
   - Coordinate fingerprinting: flag when `distanceM` is implausibly small (< ~3 m) alongside a suspiciously tight `accuracy`, or when the reported lat/lng matches the stored geo_sites centroid to more decimal places than a real GPS fix ever produces — hand-typed depot coordinates are the tell.
   - Provenance: stamp `inIp`/`outIp` from `context.rawRequest.ip` (or the `x-forwarded-for` header) onto the record and surface it in `_hrPunchDetail`, so an off-network punch is visible.
   These feed hr.js:4101-4102, which already routes `needsReview===true` days into the flagged list instead of the auto-sum — no payslip-side change needed.

5. Raise the floor against non-app callers: enable Firebase App Check (reCAPTCHA v3/Enterprise) — add the App Check SDK script to index.html, activate it in js/firebase-config.js next to the existing auth/persistence setup, then gate the callable with `functions.runWith({ enforceAppCheck: true }).https.onCall(...)` at functions/index.js:1686 (and reject when `context.app` is undefined). This blocks curl/plain-HTTP replay of the payload; it does not stop devtools inside the real app, which is why 1–4 are the substantive fix. Roll out in report-only mode first so existing workers aren't locked out.

Deploy: `cd functions && npm run deploy`. js/ and index.html changes need the usual CACHE_VER/APP_VERSION bump path; storage.rules and firestore.rules need no change (firestore.rules:411-421 already blocks client writes to these fields).

### F36 — ~95 async click/submit handlers do a Firestore write with no try/catch and (mostly) no click guard; the app's only rejection handler writes silently to Firestore, so a failed write is visually identical to the app ignoring the click

`MONEY`

**What is true**

REAL, with two corrections. No lens refuted it and my own reads confirm the load-bearing code, though the finding's line numbers have drifted 35-80 lines.

VERIFIED MYSELF IN THE CURRENT TREE:
- js/errlog.js:102 `window.onunhandledrejection` is the ONLY global rejection handler (grep over js/ and index.html returns one hit). It calls record() -> writeToFirestore() -> `window.db.collection('error_log').add(payload).catch(function(){ /* silent */ })` (js/errlog.js:43-48). No toast, no banner. It is also capped at MAX_WRITES=5 and deduped by message hash, so after five distinct errors even the Firestore trace stops.
- js/config.js:1868 `window.busy(btn, fn)` disables the button, swaps the label to 'Working...', and in `finally` restores `btn.disabled=false; btn.innerHTML=orig`. No catch - it rethrows into the void. The button resets to a pristine idle state as if the click never happened.
- js/screens/dashboards.js:5350 `document.getElementById('save-emp-btn').addEventListener('click',async()=>{...})` with `await db.collection('users').add({...})` (:5354) then `await db.collection('payroll').doc(ref.id).set({...})` (:5365) then `closeModal(); renderTeam();` (:5371) - bare async, no try, no window.busy, no disable.
- js/screens/tasks.js:817 (update-status-btn), :837 (submit-task-btn), :856 (del-task-btn), :863 (designate-btn) are the same shape, all writing to `tasks`, all with the success toast + Overlay.dismissTop() AFTER the await.

SCALE: my own scan of js/*.js + js/screens/*.js for click/submit handlers containing a db.collection write with no top-level try returns 95 across 16 files (dashboards 19, people 12, hr 11, departments 10, tasks 9, govit 8, approvals 6, ...), plus 11 window.busy-wrapped sites. The claimed 111 is approximate, not invented.

CORRECTION 1 - the Add Employee mechanism is misdiagnosed. "Employee record created but payroll record not" is not the routine path. renderTeam is gated `if(!isPresident()&&currentRole!=='manager')` (dashboards.js:5248), and firestore.rules grants both roles create on users (isSeniorAdmin(), rules:137-139) and on payroll (isMoneyAdmin(), rules:816) - no permission split can fail write 2 after write 1 succeeds, and a secretary/finance user never reaches the screen. Firestore offline persistence also means a network drop leaves the write PENDING, not rejected, so a transient failure is a hang, not a rejection. The orphan users doc needs a narrow tail (mid-session role change, invalid-argument, client termination). What IS routine is the other half: with no lock at all, an impatient re-click during a slow or hung save fires users.add twice and permanently duplicates the employee into the Team directory and every roster built on dbCachedGet('users') / fetchUsersWithPayroll. The driver is the missing click guard plus the invisible outcome, not the missing try/catch alone.

CORRECTION 2 - "no button lock" is overstated for one shape. window.busy DOES disable synchronously before any await (config.js:1872), so the ~11 busy-wrapped sites are already double-submit-safe; their defect is purely the silent reset-to-idle. The "no lock" half holds only for the bare-async sites - which is also exactly where the duplicate-record harm is real.

WHAT THE REACH LENS ADDED AND I CONFIRMED - the deterministic instance. js/screens/tasks.js:650 `const canEdit = isAdmin||isAssignee||isCreator;` gates Change Status (:713-720), Edit (:667) and Set Standing (:705). firestore.rules:512-514 `allow update: if isAuth() && ((request.auth.uid in resource.data.assignedTo) || isFinanceOrAdmin());` does NOT include the creator, and rules:505-507 let any Design-dept member create a Design task. So a non-admin Design employee who creates a task and is not an assignee is shown Update / Edit / Set and gets permission-denied on every click, forever, with zero UI feedback. Reproducible on demand, unlike the Add Employee tail. The comment at tasks.js:643-646 explicitly claims this gate "MUST match the Firestore tasks update rule" - it does not.

MONEY FLAG: affected handlers include js/screens/hr.js:2242/2255/2298 (pay_runs verify / disburse / unlock) and :1124 (payroll_delete_requests), plus js/screens/finance.js:1982 (cash-advance repair). Finance can click Disburse, see nothing change, and get no signal whether the run state moved. No amount is mis-posted, but pay-run state becomes silently unreliable.

NOT A SECURITY DEFECT - the rules boundary holds everywhere I checked. The UI is wider than the rules in one place (tasks), which is a zero-feedback denial issue, not privilege escalation.

**Fix**

Three layers, cheapest first.

1. GLOBAL SAFETY NET (one edit, covers all ~95 sites). js/errlog.js, inside `window.onunhandledrejection` (line 102), after `record(message, stack)`: surface a toast. Keep it independent of the MAX_WRITES=5 Firestore cap and dedupe on a short time window (suppress repeats of the same hash within ~5s) so a loop cannot spam. Shape:
  if (window.Notifs && window.Notifs.showToast && !recentlyToasted(key)) {
    window.Notifs.showToast(reason && reason.code === 'permission-denied' ? 'You do not have permission to do that.' : 'That did not save - please try again.', 'error');
  }
Wrap in try/catch to preserve the file's "logging can never throw" contract. Do NOT toast raw reason.message - it leaks Firestore internals; map code -> friendly string.

2. HARDEN window.busy (js/config.js:1868). Add a catch that toasts and rethrows, keeping the finally:
  try { return await fn(); }
  catch (e) { window.Notifs?.showToast(friendlyErr(e), 'error'); throw e; }
  finally { btn.disabled = false; btn.innerHTML = orig; }

3. FIX THE TWO CONCRETE HARMS.
 a) js/screens/dashboards.js openAddEmployeeModal (:5350-5372) - make it atomic AND locked. Replace the two sequential awaits with a pre-allocated id plus a single batch, wrapped in window.busy:
   const btn = document.getElementById('save-emp-btn');
   btn.addEventListener('click', () => window.busy(btn, async () => {
     const ref = db.collection('users').doc();            // id allocated client-side, no write yet
     const batch = db.batch();
     batch.set(ref, { ...profileFields });
     batch.set(db.collection('payroll').doc(ref.id), { salary, allowance, deductions });
     await batch.commit();                                // atomic - both or neither
     window.logAudit && window.logAudit('create','payroll',ref.id,{ salary });
     dbCacheInvalidate('users'); dbCacheInvalidate('users-presence'); closeModal(); renderTeam();
   }));
   This kills both the double-click duplicate (busy disables synchronously) and the orphan-users-doc tail (batch is atomic).
 b) js/screens/tasks.js:650 - split the gate so the UI stops rendering controls the rules deny: `const canEdit = isAdmin || isAssignee;` for the update-driven controls (edit-task-btn :667, Set Standing :705, Change Status :713-720), and a separate `const canDelete = isAdmin || isCreator;` for del-task-btn (firestore.rules:517 DOES allow the creator to delete). Update the stale comment at :643-646. Alternative: widen firestore.rules:512-514 with `|| resource.data.get('createdBy','') == request.auth.uid` if creators are meant to manage their own tasks - but pick one side; today the two disagree.

4. THEN convert the remaining bare-async handlers to `() => window.busy(btn, async () => {...})` mechanically, prioritising the money/pay surface: js/screens/hr.js:2242 (pr-verify-btn), :2255 (pr-disburse-btn), :2298 (pr-unlock-btn), :1124 (submit-del-req-btn); js/screens/tasks.js:817/:837/:856/:863; js/screens/finance.js:1982 (ca-repair-apply-btn). With fix 2 in place each of those gets a lock AND a message with no per-site try/catch.

Note: do not hand-edit APP_VERSION / CACHE_VER - the pre-commit hook rewrites both. js/errlog.js and js/config.js are already in the sw.js PRECACHE list.

### F45 — Analytics "Payroll % of Revenue" divides one month of payroll by the whole period's revenue (default YTD) — understates the ratio by ~N months elapsed on two cards, and de-sensitises the payrollHigh warning

**What is true**

CONFIRMED by my own read of the tree; all three lenses were right, and I follow none of their refutations because none refuted — only their corrections. The numerator/denominator mismatch is verbatim present: js/screens/dashboards.js:4625 `const anPeriod = window._AN_PERIOD || 'ytd';`, :4626-4629 `const ledInP = sum(ledger.filter(l=>ledgerKind(l)==='income'&&finPeriodMatch(l.date,anPeriod)), l=>l.amount); ... const revP = ledInP || wonQuotesP;`, :4631 `const payrollTotal = sum(users, u=>(+u.salary||0)+(+u.allowance||0)-(+u.deductions||0));` (a MONTHLY rate — js/screens/finance.js:239 "Type A (regular staff, monthly ...)"), :4647 `payrollTotal, payrollRatio: window.payrollRatio(payrollTotal, revP)`. js/config.js:900-902 `window.payrollRatio` does a bare `totalPayroll/revenue*100` with zero period normalisation, and js/config.js:1993/2005 confirm `'ytd'` parses to `year:YYYY` → Jan 1–Dec 31. Reachable on first paint for president/manager/secretary/finance (js/screens/dashboards.js:4489 gate, js/config.js:493 first sidebar item, :5243 `renderOverview()` called unconditionally), and the card at :4739 is unconditional markup — notably the ONLY tile in that kpi-row with no `(${anPlabel})` period suffix, while its sub-label `₱${fmt(totalPayroll)}/mo` actively asserts a monthly frame. Firestore rules grant the president both halves (firestore.rules:815 payroll read via isFinanceOrAdmin, :1464 ledger read via canFinance), so this is real non-zero data, not a silent 0.

THREE CORRECTIONS to the finding's framing, all of which I accept:
(1) "Permanently disarmed / structurally never fire" is overstated. The metric is denominator-unstable, not uniformly low: in the first days of January YTD is a PARTIAL month so the ratio overshoots and payrollHigh can fire SPURIOUSLY; it crosses correct around end-January; from ~February onward it decays toward 1/N of truth, reaching ~12x understatement in December. So the accurate claim is that the 35% alarm (js/config.js:952 `payrollRatioWarnPct: 35`, consumed at js/config.js:990 `function payrollHigh(M, P){ if (!(M.revP > 0) || M.payrollRatio <= P.payrollRatioWarnPct) return null;`) becomes progressively unreachable for ~11 months of the year — at the finding's own seeded numbers it would need ₱1.26M/mo payroll vs ₱77.6k actual. Also the "All Time" period makes it effectively infinite, as the finding says.
(2) The bug is on TWO cards, not one. js/screens/dashboards.js:4928 `const totalPayroll = M.payrollTotal;` + :4952 `const payrollPct = window.payrollRatio(totalPayroll, finInP);` renders a second "Payroll % of Revenue" tile at :4969 on the Finance subtab against the same period-scoped denominator (`finInP`, :4946) — and that one has NO period label AND no `/mo` sub-label at all.
(3) The denominator is `revP = ledInP || wonQuotesP` — period ledger income with a fallback to period accepted-quote totals — not strictly ledger revenue. The mismatch holds identically on both branches.

Root cause is visible in the code itself: the consumer variable is still named `revMTD` (js/screens/dashboards.js:4698 `const revMTD = M.revP`) and js/config.js:895-899 documents "Overview passes revMTD" — i.e. the pairing was correct when revenue was month-to-date, and the WS12 period engine widened the denominator to a YTD default without ever normalising the monthly numerator. Line numbers in the finding (4662/4668/4684) have drifted ~37 lines; the code is otherwise quoted accurately, and `git log` shows no later fix. Severity high but not critical: no peso amount, ledger row or pay is altered — this is a decision-support display defect plus a suppressed guardrail, correctable by the viewer manually switching the picker to "This Month".

**Fix**

Normalise the two figures to the same time base at both call sites; do NOT change `window.payrollRatio` itself (js/config.js:900-902 is shared and deliberately byte-identical across callers — normalise the inputs instead).

1. Add a period-length helper next to the Period engine in js/config.js (after the `window.Period` IIFE, ~line 2020, before `window.finPeriodMatch` at :2028):
   `window.periodMonthsElapsed = function(key, asOf){ const p = window.Period.parse(key); const today = asOf || window.bizDate(); if (p.type === 'all') return null; const start = p.start, end = (p.end < today ? p.end : today); if (end < start) return 0; ... }` returning elapsed months as a FRACTION (full months between start and end, plus dayOfMonth/daysInMonth for the trailing partial month), floored at a small epsilon (e.g. `Math.max(x, 0.25)`) so the first days of January cannot produce a divide-by-near-zero spike. Return `null` for `'all'` so callers can fall back to the span of the ledger dates (or simply render `—`). Use `window.bizDate()`/`bizYear()` throughout — never `toISOString()` (per the Manila-time convention in this repo).

2. js/screens/dashboards.js, `buildMetricsSync` (~4624-4655): after line 4631 compute
   `const anMonths = window.periodMonthsElapsed(anPeriod);`
   `const revPerMonth = (anMonths && anMonths > 0) ? revP / anMonths : null;`
   and change line 4647 to
   `payrollTotal, payrollMonths: anMonths, revPerMonth, payrollRatio: (revPerMonth ? window.payrollRatio(payrollTotal, revPerMonth) : null),`
   (Algebraically equivalent alternative: scale the numerator by `anMonths` instead — pick one and use it in both places.) Export `revPerMonth`/`payrollMonths` on the bag so the cards and the insight rule can describe what they compared.

3. js/screens/dashboards.js:4739 (Overview card): label the tile honestly, e.g. `Payroll % of Revenue (monthly avg)` and change the sub-label to `₱${fmt(totalPayroll)}/mo vs ₱${fmt(M.revPerMonth)}/mo avg` (guard the null case → `—` plus `add ledger income`). This removes the silent frame mismatch that made the tile the only unlabeled one in the row.

4. js/screens/dashboards.js:4952 (Finance subtab, second instance): replace
   `const payrollPct = window.payrollRatio(totalPayroll, finInP);`
   with the same normalisation against `finInP`:
   `const finMonths = window.periodMonthsElapsed(finAnPeriod); const finInPerMonth = (finMonths && finMonths > 0) ? finInP / finMonths : null; const payrollPct = finInPerMonth ? window.payrollRatio(totalPayroll, finInPerMonth) : null;`
   and add the same "(monthly avg)" wording plus a `/mo` sub-label to the tile at :4969. Update the stale comment block at :4948-4951 ("do not unify") to say the DENOMINATOR SOURCE still differs (pure ledger income vs revP's quote fallback) but both are now per-month.

5. js/config.js:990 `payrollHigh` then reads the corrected `M.payrollRatio` with no threshold change. Tighten its guard so the normalised ratio cannot spike on a near-empty period: change `if (!(M.revP > 0) || ...)` to `if (!(M.revP > 0) || M.payrollRatio == null || !(M.payrollMonths >= 0.5) || M.payrollRatio <= P.payrollRatioWarnPct) return null;` and reword the sentence at :991 from "% of period revenue" to "% of average monthly revenue in ${M.periodLabel}".

6. Separate, smaller defect worth fixing in the same edit: js/screens/dashboards.js:4631 sums EVERY user doc with no active/terminated filter, so departed staff keep inflating the numerator. Filter to active users (match whatever `status`/`active` field `fetchUsersWithPayroll` merges, js/config.js:628-640) the way the pay-run compute path does.

No Firestore rules or index changes are needed. `CACHE_VER` is derived from `APP_VERSION` and auto-bumped by the pre-commit hook, so no manual sw.js edit. Verify by loading Analytics with the picker on the default period and on "This Month" — the two readings should now agree, and the Conclusions card should surface the payroll warning at a genuine >35% monthly ratio.

### F49 — Ledger-tab ✎ edit updates the ledger row but never syncs finance_rollup, so Finance Overview's all-time Income/Expense KPIs silently drift by the edit delta (cumulative, President-only repair)

`MONEY`

**What is true**

Confirmed in the working tree; all three lenses stand and I re-read every cited line. js/screens/finance.js:1413-1434 routes a `ledger` row (date/type/description/amount/category/refNumber) into window.financeEditModal with only `onSaved:redo` (redo = renderLedgerTab, a pure re-render) and no `transform`. financeEditModal's entire write is `await db.collection(collection).doc(docId).update(upd);` (js/screens/finance.js:180) — no window.Ledger._syncRollup, no dbCacheInvalidate('finance_rollup'). This is the ONLY money-mutating edit path in the app that omits the sync: post/upsertByRef/postMulti do it (js/finance-ledger.js:346, 395-396, 454), deletes do it (js/departments.js:570-573), the payroll-history edit does the exact subtract-old/add-new pattern (js/screens/hr.js:1067, 1088-1092), and the sibling financeEditModal callers for expenses/CRJ/CDJ chain `resyncLedgerForSource(...).then(redo)` (js/screens/finance.js:1700, 1802, 2183). Finance Overview's Total Income / Total Expenses come exclusively from finance_rollup (js/screens/finance.js:2115, 2122-2123), and the "Totals need a rebuild" banner only fires when finance_rollup is entirely empty (:2129-2133), so per-row drift is invisible. Nothing repairs it: `finance_rollup` appears nowhere in functions/ (no server trigger), and the only recompute is window.Ledger.rebuildRollups (js/finance-ledger.js:622-624, president-only) behind the isPres-gated Finance Tools button (js/screens/finance.js:2136). Because _syncRollup applies incremental deltas on top of stored values (js/finance-ledger.js:290-303), the error persists and compounds across edits.

Corrections I adopted from the refuters. (1) The peso figure is wrong: drift equals |old amount − new amount|, so the reproduced 30,000→3,000 correction overstates Overview by ₱27,000, not ₱22,000. (2) The "same books, one chip apart" framing is not a valid signal: Overview sums EVERY finance_rollup doc with no period filter (all-time), while Reports is period-scoped via ledgerForPeriod/Period.match, so the two are not expected to match — the real defect is that Overview's all-time totals shift by the cumulative sum of edit deltas with no warning. (3) The finding under-states scope in three ways: it is not just `amount` — editing `type` or `category` also corrupts the income/expense split and finance_rollup.byCategory (and vatOutput/vatInput, since _rollupDelta runs computeVatSummary), because the old row is never subtracted; the control is not finance-role-only — it is gated on isFinancePriv() = canEditDept('Finance') (js/departments.js:17-27), true for president/owner/manager/secretary, role finance, and any user with 'Finance' in currentDepts; and firestore.rules:1512-1513 permits the bare update with no ledgerPeriodOpen()/ledgerDateOk() gate (unlike create at :1488), so even a closed period doesn't stop it and no error toast ever fires. (4) hr.js line cite drifted (1067/1088-1092, not 1027-1034). No lens refuted the core claim, and my own reading of finance.js:180, 1400-1434, 2112-2146, finance-ledger.js:283-316, hr.js:1060-1092 and firestore.rules:1443-1459 matches.

**Fix**

Make the Ledger-tab edit do the same subtract-old/add-new that every other path does.

1) js/screens/finance.js — window.financeEditModal (line 139, save handler at 168-183): pass the saved values to the callback so callers can compute the new row. Change `onSaved && onSaved();` (line 181) to `onSaved && onSaved(upd);`. This is backward-compatible — every existing caller ignores the argument.

2) js/screens/finance.js:1413 — the `.led-edit-btn` non-journal branch: replace `onSaved:redo` with a rollup-aware callback that closes over the pre-edit row `e` (already in scope from `entries.find(...)` at :1403):

   onSaved: async (upd) => {
     const S = window.Ledger && typeof window.Ledger._syncRollup === 'function' ? window.Ledger._syncRollup : null;
     if (S) {
       await S(e, -1);                       // remove the old row's contribution
       await S({ ...e, ...upd }, +1);        // add the corrected row's contribution
     }
     if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('finance_rollup'); dbCacheInvalidate('ledger'); }
     redo();
   },

   Note `e` is the row as rendered, so `{ ...e, ...upd }` carries date/type/amount/category through _rollupDelta correctly; _syncRollup is already best-effort/never-throws and self-invalidates the finance_rollup cache, so the extra dbCacheInvalidate is belt-and-braces. Counts net out (-1 then +1). The `general_journal` branch at :1405 needs no change — journal legs do not feed finance_rollup.

3) Optional hardening in the same file, so the next caller can't reintroduce this: inside financeEditModal, after a successful update, add `if (collection === 'ledger' && !opts.skipRollupSync) console.warn(...)` — or better, accept an explicit `rollupOldRow` option and perform the -1/+1 internally when `collection === 'ledger'`, making the sync the default rather than the caller's responsibility.

4) Optional UX: js/screens/finance.js:2129-2133 — the staleness banner only fires on an empty finance_rollup. Consider stamping a `rollupDirty` marker (or comparing `sum(count)` against a cheap `ledger` count) so a drifted-but-non-empty rollup surfaces a "Totals may be stale" hint instead of silently printing a wrong headline.

No firestore.rules change is needed — rules already permit the finance_rollup create/update (firestore.rules:1457-1459) for any canFinance() user. Bump CACHE_VER via the normal commit hook after editing js/screens/finance.js.

### F50 — /ledger UPDATE is the one money-collection rule with no period-close (or date-format) check — a closed month's ledger rows can still be edited, restating filed P&L and VAT

`MONEY` `SECURITY`

**What is true**

Verified directly. firestore.rules:1512-1513 reads `allow update: if isAuth() && canFinance() && request.resource.data.get('bankFlow','') in ['','in','out'];` — no ledgerDateOk(), no periodOpenFor() — while the sibling create rule (firestore.rules:1488 `allow create: if isAuth() && ledgerDateOk() && ledgerPeriodOpen() ...`) and cash_receipt_journal / cash_disbursement_journal / general_journal updates (firestore.rules:1530/1535/1540) all carry both. The client half is missing too: window.financeEditModal (js/screens/finance.js:139, the only definition in the repo) collects fields, stamps editedBy/editedByName/editedAt, and goes straight to `await db.collection(collection).doc(docId).update(upd)` at :180 with no isPeriodClosed/assertPeriodOpen anywhere in the function (repo-wide, assertPeriodOpen appears in finance.js only at :1753 CRJ and :1871 CDJ). It is invoked with collection:'ledger' at :1413 with date, type, amount, category and refNumber all editable, from an ✎ button rendered under a bare `if (canFin)` (:1279, :1402) on every one of the 100 rows the tab lists unfiltered by month (:1209). The effect is real and permanent: closeFinancePeriod snapshots no figures (js/departments.js:2518 writes only {closed,closedBy,closedAt}), and the Income Statement (ledgerForPeriod, js/config.js:788) and VAT (js/bir.js:80 computeVatSummary, shared by Reports, the 2550 worksheet and the FS print) re-derive from the live ledger on every render, so a post-close amount or date edit silently restates an already-filed month. Actors: role finance/manager and any Finance-department member (canFinance(), firestore.rules:31-43); president bypass is deliberate. All three lenses stand and I agree with them.

Two scoping corrections to the finding's framing, neither of which weakens it. (1) It overstates when it says the period-close control "does not hold" — it holds for ledger CREATE, for CRJ/CDJ/GJ create+update, and ledger DELETE is president-only. The hole is specifically UPDATE of an existing /ledger row. (2) The same ✎ button's general_journal branch (js/screens/finance.js:1405) IS backstopped by firestore.rules:1540, so a closed-month GJ edit fails with a permission error — the identical UI silently succeeds on the /ledger branch, which is exactly the collection the P&L/VAT reports read, and makes the gap undetectable to the user. Worth adding on top of the finding: because ledgerDateOk() is also absent from the update rule, the `date` field itself can be rewritten to an arbitrary or malformed value, moving a row into or out of any period (a malformed date buckets to 'undated' in the rollup and can vanish from orderBy('date') reports). Also, financeEditModal never calls _syncRollup, so the edit shifts the Income Statement while leaving finance_rollup/{yyyymm} — which feeds the Overview KPI tiles — stale.

**Fix**

Two layers; the rules layer is the boundary and must land regardless.

1) firestore.rules — `match /ledger/{docId}`, replace the update rule at :1512-1513. Keep the loose path only for non-material maintenance writes (bank reconciliation/clearing/re-tag), which legitimately happen on old rows and touch no reported figure; gate everything material on the period, checking BOTH the pre-edit and post-edit month so a row cannot be moved into or out of a closed period. Add near ledgerPeriodOpen() (~:1410):

  function ledgerNonMaterialUpdate() {
    return request.resource.data.diff(resource.data).affectedKeys().hasOnly(
      ['reconciled','reconciledBy','reconciledAt','cleared','clearedBy','clearedAt',
       'bankAccountId','bankAccountName','bankFlow','editedBy','editedByName','editedAt']);
  }
  function ledgerOldPeriodOpen() {
    // legacy rows with a missing/malformed date can't be month-keyed; don't
    // hard-deny them (periodOpenFor would throw on the split) — the new-date
    // check below still applies.
    return !resource.data.get('date','').matches('^\\d{4}-\\d{2}(-\\d{2})?$')
        || periodOpenFor(resource.data.get('date',''));
  }

then:

  allow update: if isAuth() && canFinance()
    && request.resource.data.get('bankFlow', '') in ['', 'in', 'out']
    && ( ledgerNonMaterialUpdate()
         || ( ledgerDateOk()
              && ledgerOldPeriodOpen()
              && periodOpenFor(request.resource.data.get('date', '')) ) );

Note ledgerDateOk() must stay inside the material branch, not hoisted — the reconciliation/clearing writes (js/screens/finance.js:1635/1649, js/bir.js:1291) merge onto rows that may predate the date-format discipline, and hoisting it would break them. Deploy separately from `git push`: `firebase deploy --only firestore:rules` (CLI at ~/.npm-global/bin/firebase), and re-`git diff` firestore.rules immediately before deploying (concurrent sessions edit this tree).

2) js/screens/finance.js — client guard so the user gets the standard "That month's books are closed…" toast instead of a raw permission error.
  a. window.financeEditModal (:139): accept an optional `periodField` (e.g. 'date') in the destructured options. In the save handler, after `upd` is built and before the `.update()` at :180, add: `if (periodField && upd[periodField] && window.assertPeriodOpen) { try { await window.assertPeriodOpen(upd[periodField]); } catch(_) { return; } }` — this catches moving a row INTO a closed month.
  b. The ✎ handler at :1400-1435: make the listener `async`, and before opening either modal add `try { await window.assertPeriodOpen(e.date); } catch(_) { return; }` (guards the row's CURRENT month, and fixes the GJ branch's raw-permission-error UX at the same time). Pass `periodField:'date'` on both financeEditModal calls (:1405 and :1413).
  c. Optional polish in renderLedgerTab (~:1246-1280): the screen already knows how to ask (window.isPeriodClosed, used at :692) — resolve the distinct month keys of the 100 fetched rows once and render the ✎ button disabled with a 🔒 title on closed-month rows, so the control is not offered at all.
Leave js/screens/finance.js:2183 (expenses, already guarded at js/departments.js:3977) and the cash_advances call at :2073 alone — this fix is ledger/GJ-scoped.

Bump nothing by hand: the pre-commit hook handles APP_VERSION/CACHE_VER.

### F51 — Cash Receipts (and manual income ledger rows) have no VAT-treatment field, so computeVatSummary's 12/112 fallback taxes exempt/zero-rated receipts and overstates Net VAT Payable on the 2550 worksheet

`MONEY`

**What is true**

The defect is real and I confirmed every link in the chain in the live tree. js/bir.js:80 `const v = (e.vatAmount != null) ? e.vatAmount : (amt - amt / 1.12);` is the only VAT derivation for income rows; postCRJToLedger's income leg (js/departments.js:335-338) writes `extra: { ...tag }` with no vatAmount/vatTreatment; the "New Cash Receipt Entry" modal (js/screens/finance.js:1706-1726, buildDoc 1736-1751) has no VAT control at all, while the Cash Disbursement modal does (#cdj-vat, :1829-1834, written at :1863) and the manual Ledger modal shows its VAT field only when `type==='debit' && accountType==='expense'` (:1341-1343) — i.e. never on an income row. Ledger._mapEntry only auto-attaches VAT when `entry.vatTreatment` is set (js/finance-ledger.js:202-228), and the CRJ resync branch (js/departments.js:410-414) carries no VAT while the CDJ branch does (:424). Both consumers are live: Reports' Tax/VAT block (js/screens/finance.js:687, 765-767) and the 2550 worksheet (js/bir.js:450, 459-463), whose figure is persisted to tax_records (js/bir.js:487). No rule blocks the untagged write and no UI anywhere can correct it after the fact.

Three corrections to the write-up, none fatal. (1) "every cash receipt" is too broad: the A/R-collection leg posts as accountType 'asset' (js/departments.js:341) so it is filtered out at js/bir.js:66, and a sundry receipt booked under free text (e.g. "Loan Payable") fails `incomeCats.includes()` at js/bir.js:76 — I confirmed window.COA.income is exactly ['Sales Revenue','Other Income'] (js/config.js:1926). The accurate scope is: anything entered in "Credit: Sales Revenue", or in Sundry with a blank/'Other Income' account, plus manual credit/income ledger rows. (2) "Fabricated" overstates it for the common case — BIRCONFIG.vatRegistered is true and 12/112 on a VAT-inclusive sale is the correct output VAT, so the fallback is right for an ordinary sale. The real defect is the missing treatment control: an exempt, zero-rated or export sale cannot be marked as such, and the error direction is over-statement (overpaying BIR), not under-statement. (3) Neither refuter caught the strongest corroborator: js/bir.js:334 documents that the Cash Receipts Book shows a BLANK output-VAT column for exactly these rows ("that's accurate, not a bug in this print"), so on the same BIR screen the CRB totals ₱0 output VAT while the 2550 worksheet bills 12/112 on the same receipts. Two filing worksheets disagree about the same transactions. I did not follow either lens's implied downgrade: the sales-order path tagging VAT correctly (js/departments.js:3338, js/screens/production.js:905) narrows the blast radius but does not close the Cash Receipts chip, which is a standing member of Money In/Out (js/screens/finance.js:192, 365) with an ungated add button (js/ui-crud-table.js:108).

**Fix**

Make the income side symmetric with the expense side; keep 12/112 as the default so ordinary VATable sales are unchanged.

1. js/screens/finance.js — renderCashReceiptJournal addModal.bodyHtml (~:1706-1726): add an Output VAT select `#crj-vat` next to the bank picker, mirroring #cdj-vat at :1829-1834, with options `inclusive` (default — "VATable, 12% output VAT included in the amount"), `zero` ("Zero-rated / export sale — 0% VAT") and `exempt` ("VAT-exempt / not a sale"). In buildDoc (~:1736-1751) compute `const _crjBase = creditSalesRevenue + creditSundryAmount; const _crjOutVat = (treatment === 'inclusive') ? window.vatSplit(_crjBase, 'inclusive').vat : 0;` and write `vatAmount: _crjOutVat, vatTreatment: treatment` onto crjData, exactly as the CDJ does at :1863.

2. js/screens/finance.js — CRJ editFields (~:1687-1697): add a `vatTreatment` select, and add an editBeforeSave that recomputes `upd.vatAmount` from the edited revenue+sundry legs, mirroring the CDJ recompute at :1806-1808 (`if (e.vatTreatment !== 'inclusive') { upd.vatAmount = 0; return; } upd.vatAmount = window.vatSplit(base,'inclusive').vat;`).

3. js/departments.js — postCRJToLedger (~:336-338): change the income leg to `extra: { vatAmount: e.vatAmount || 0, vatTreatment: e.vatTreatment || '', ...tag }`. Leave the A/R leg (~:341) untouched — it must stay untagged and asset-typed. Then in resyncLedgerForSource's `cash_receipt_journal` branch (~:410-414) carry `vatAmount`/`vatTreatment` into the patch the same way the CDJ branch carries `inputVat = e.vatAmount || 0` at :424 (the patch builder currently only knows about `inputVat`, so add a parallel `outputVat`/`vatAmount` variable and include it in the update object).

4. js/screens/finance.js — manual Ledger modal (~:1330-1343): drop the expense-only condition in `ledUpdateVatVisibility` and instead render an output-VAT variant for `type==='credit' && accountType==='income'`, writing `vatAmount` (not `inputVat`) into the posted entry's `extra`, so computeVatSummary reads it. Reuse window.vatFieldHTML with a relabeled "Output VAT" heading, or add a `window.vatFieldHTML(id, def, {label})` param in js/bir.js:49-56.

5. js/bir.js — computeVatSummary (~:71-86): keep the 12/112 fallback for legacy rows, but count what it touched — accumulate `untaggedSales += amt` when `e.vatAmount == null` and return it. Then in birRenderVatBody (~:456-464) print a caveat row under Output VAT ("₱X of sales carried no recorded VAT treatment and was assumed VATable at 12%") and include `untaggedSales` in the `sourceFigures` written to tax_records at :487, so an accountant reviewing a filed worksheet can see the assumption. Also make birRenderCRB (js/bir.js:352) use the same fallback (or print the same caveat) so the Cash Receipts Book and the 2550 stop reporting different output VAT for the same receipts, and delete the now-wrong comment at :333-336.

6. js/screens/finance.js:768 — the Reports caption claims "Output VAT is summed per sale's VAT treatment (inclusive / exclusive / exempt)", which is false today for CRJ/manual rows; reword to state the assumed-VATable fallback until step 5 lands.

No firestore.rules change is required — cash_receipt_journal (firestore.rules:1528-1530) and the ledger match block validate no VAT fields — but if field-level validation is ever added, whitelist vatAmount/vatTreatment there too. Bump CACHE_VER via the normal commit path after editing these JS files.

### F52 — Deleting one employee's salary_history removes only that line's two debit legs — the run's shared aggregate credit legs are never adjusted, so the month's ledger goes out of balance by exactly (effectiveGross + employer share)

`MONEY`

**What is true**

Confirmed by my own read; all three lenses agree and I found nothing that refutes it. financeDeleteCascade's `salary_history` branch (js/departments.js:500-525) stages exactly two ledger deletes — PAY-{month}-{uid} and PAY-{month}-{uid}-ER, both DEBITS to Payroll Expense (posted at js/departments.js:2286-2291 and 2297-2302) — plus cash_advances balance restores. The CREDIT side of that same employee's line lives entirely in per-run aggregate rows: SSSPAY-/PHPAY-/HDMFPAY-/WHTPAY-{month} (js/departments.js:2335-2338), CADEDUCT-{month} (2385), CAINT-{month} (2393), EMPDED-{month} (2411) and NETPAY-{month} (2417). Nothing re-derives them on delete — the code says so itself ("Known gap, left for whoever builds WS39", js/departments.js:504-509) — and disbursePayRun is the ONLY writer of those refs anywhere in js/ (verified by grep; js/bir.js only reads them). Reachability is real and unblocked: js/screens/hr.js:988-992 renders .hist-del-btn for any canFinance user, js/screens/hr.js:1114 calls window.financeExecuteDelete('salary_history', hid) directly for the President with no assertPeriodOpen on that path (the only period gate in the screen is on the EDIT modal, hr.js:1034), js/screens/hr.js:1165 does the same on in-page request approval, and js/svc-approvals.js:83 does it from the Approvals feed ('finance-req', president-only). firestore.rules permits every write in the batch for the President (salary_history delete :821-827, ledger delete :1514 — the ledgerPeriodOpen() gate exists only on create, :1488). So the batch at js/departments.js:548-560 commits and the books are left credit-heavy by precisely that employee's effectiveGross + erTotal (₱30,575 on the fixture line). CORRECTIONS I ADOPT: (1) line numbers in the finding have drifted — see the refs above; (2) the finding's list of orphaned credits omits EMPDED-{month} and CAINT-{month}, which are stranded for the same reason; (3) the claimed direction is partly wrong — in the ordinary case (the employee really was paid, contributions really were withheld) NETPAY's Cash credit and the agency payables are still CORRECT and what is wrong is the debit side: Payroll Expense understated and net income / Retained Earnings overstated by the same ₱30,575. Either way the trial balance stops netting to zero by exactly that amount, which is the load-bearing claim. (4) It is not fully silent — js/bir.js:598-607 shows a banner when the WHT leg disagrees with the per-employee total — but that is one report, WHT only, after the fact; nothing flags the SSS/PhilHealth/Pag-IBIG/EMPDED/CADEDUCT/NETPAY legs or the trial balance, and the Balance Sheet just absorbs it into an already-nonzero "Unreconciled difference" plug on a section labelled PROVISIONAL (js/bir.js:893, 906). (5) It only bites for a month that reached the ledger-posting stage of disbursePayRun; a row frozen by a run that aborted before js/departments.js:2286 has no PAY- row and produces no imbalance. Not self-healing: the only way those aggregates get rewritten is another Disburse / Resume Disburse (js/screens/hr.js:2274, 2291), which re-freezes salary_history from the still-intact run.lines — i.e. it un-deletes the record rather than repairing the books.

**Fix**

Do NOT try to edit the shared aggregate rows in place (they are cross-employee and, per the R1 comment at js/departments.js:2380, CADEDUCT/NETPAY are not re-derivable from run.lines). Post a per-employee REVERSING entry instead, in the same atomic batch. In `financeDeleteCascade`'s `salary_history` branch (js/departments.js:500-525), after the two `stageLedgerDelete` calls, stage one new ledger doc with ref `PAYREV-{month}-{uid}` carrying the debit side of that line's credit contributions, all read straight off the doc being deleted: SSS Payable d.sss+(d.er?.sss||0); PhilHealth Payable d.philhealth+(d.er?.philhealth||0); Pag-IBIG Payable d.pagibig+(d.er?.pagibig||0); Withholding Tax Payable d.tax; Employee Deductions Payable d.deductionsWithheld (fall back to d.deductions for pre-2026-08 rows, per the freeze comment at js/departments.js:1944-1946); Advances to Employees Σ d.caDeductions[].principal and Other Income Σ d.caDeductions[].interest (the split is already frozen — js/config.js:2759 pushes {caId, amount, principal, interest}); Cash d.finalPay. Emit these as `type:'debit'` rows (either one row per account with refs `PAYREV-{month}-{uid}-SSS` etc., or a small helper mirroring `upsertLedger`) so each is independently idempotent and the sum equals the effectiveGross+erTotal of debits being removed — the trial balance then stays at zero by construction and each aggregate's NET position steps down by exactly this employee's share. Two things must ship with it: (a) also stage removal of the employee's line from the run so a later Resume Disburse does not re-post the aggregates including the deleted employee and double-count against the reversal — either splice `line.uid` out of `pay_runs/{month}.lines` in the same batch (pay_runs is rules-immutable post-disburse, so this needs a matching allowance in firestore.rules, or a `pay_runs/{month}.deletedUids[]` array that disbursePayRun filters on at js/departments.js:1926 `const lines = run.lines || []`), and (b) guard the whole branch: if no `PAY-{month}-{uid}` row was found, skip the reversal entirely (the run never reached ledger posting — see the abort case above) so an undisbursed row's delete stays a no-op on the ledger. If you want the minimal stopgap instead of the full fix, add a hard block in `window.financeExecuteDelete` (js/departments.js:548) for `collection === 'salary_history'` when `_findLedgerRowByRef('PAY-{month}-{uid}')` resolves — refuse with "this payroll record is already posted to the ledger; reverse the run or file a correcting journal entry" — which trades the silent imbalance for an honest refusal. Finally, once the reversal exists, drop the now-stale "Known gap, left for whoever builds WS39" comment at js/departments.js:504-509 and the compensating warning text at js/bir.js:607.

### F55 — Manager → President privilege escalation: the users CREATE rule lacks the role != 'president' guard the UPDATE rule has, and the Invite / Create Worker Account forms both offer 'president' in the role picker

`SECURITY`

**What is true**

STANDS, verified first-hand. firestore.rules:137-141 allows users-doc creation on a bare `isSeniorAdmin()` (= president OR manager) with no constraint on `request.resource.data.role`, while the UPDATE rule immediately below (firestore.rules:199-203) was deliberately hardened with `isSeniorAdmin() && !isOwner(uid) && request.resource.data.get('role','employee') != 'president'` — complete with a v14 re-audit comment describing that exact escalation. So a manager cannot promote anyone to president, but can mint a brand-new president. Authority is purely the role string on both sides: firestore.rules:14-16/23 getRole()/isPresident() read users/{request.auth.uid}.role, js/app.js:1315 and js/modules.js:41-44 are role-only on the client, and functions/index.js:492 syncUserClaims copies role:'president' into the Auth custom claims that storage.rules trusts.

Two client paths are operational end to end, both reachable by a manager (js/app.js:1341 gives managers the admin nav; js/screens/people.js:391 includes 'manager' in `pres`):
1. Invite Team Member — js/screens/people.js:506 role <select> renders all of window.ROLES unfiltered (js/config.js:379 lists president first); :534 creates the Auth account on a secondary app, :545-556 writes users/{uid}.set({... role: #inv-role ...}), :566 sends the password reset to whatever address was typed.
2. Create Worker Account — js/screens/dashboards.js:5420 `cw-role` is likewise unfiltered, and :5476-5493 creates the Auth account with a password the manager types and can read on screen, then writes users/{uid}.set({role, ...}) plus the usernames/{u} login map. The finding missed this path; it is strictly worse than Invite because no attacker-controlled mailbox is needed.

Scope corrections I am adopting from the refuters (all three voted STANDS and all three were right on the substance): (a) the "Add Employee Profile" form the finding cited (js/screens/dashboards.js:5338/5354) is NOT an escalation vector — it uses db.collection('users').add(), minting an auto-ID doc that can never be any request.auth.uid, so it yields a dangling President-labelled profile row, not a login. I checked the one adoption path (functions/index.js:214-217) and it only claims docs with pendingPasswordSetup===true, whose sole writer js/svc-approvals.js:44-50 hardcodes role:'employee'. (b) Two of the five powers the finding named are already manager-level and not newly gained: cash-advance approval is isFinanceOrAdmin() (firestore.rules:463-464) and audit_log read is isAdmin() (firestore.rules:1725-1726). The genuinely new tier is isPresident()-only: settings/{docId} write (firestore.rules:759-761 — the force-logout kill switch at js/app.js:285-287 / dashboards.js:5322), finance_delete_requests approval (firestore.rules:1596-1599), finance_periods close/reopen and the periodOpenFor() bypass (firestore.rules:1424), users-doc deletion (firestore.rules:209), and the ~40 other `allow delete: if isAuth() && isPresident()` rules. That is precisely the set the design reserves for the owner — the whole "finance deletes route to the President" control collapses if the president tier is forgeable. (c) The finance role is shown the Invite button but the create rule denies it, so the exploitable population is exactly the manager role, as the finding said. (d) functions/index.js:184-256 createUserDocOnAuthCreate is a non-deterministic partial mitigation only: if the trigger's role:'employee' doc lands first the client .set() is evaluated as an update and the hardened update rule denies it — but a cold-start trigger loses to one client round-trip in the normal case, and a loss is simply retryable with another email/username. Neither invite nor create-worker writes an audit_log entry for the role assignment, so the escalation leaves no trail. Severity high rather than critical only because the actor must already hold the manager role; the rules layer (not the UI) is the boundary and it is open.

**Fix**

Rules first — the UI is not the boundary.

1) firestore.rules, `match /users/{uid}` CREATE (lines ~137-150): mirror the UPDATE rule's structure. Split president out unconditionally and add the missing role predicate to the senior-admin branch:

    allow create: if isAuth() && (
      isPresident() || (
        isSeniorAdmin()
        && request.resource.data.get('role', 'employee') != 'president'
      ) || (
        isAdmin() && request.resource.data.get('role', 'employee') in ['employee', 'agent', 'finance']
      ) || (
        isOwner(uid)
        && request.resource.data.role == 'employee'
        && request.resource.data.get('department', '') != 'Finance'
        && request.resource.data.get('department', '') != 'Design'
        && !request.resource.data.get('departments', []).hasAny(['Finance','Design'])
      )
    );

   While in there, also whitelist the role enum on the senior-admin branch (`... .get('role','employee') in ['manager','secretary','employee','agent','finance','partner']`) so an unknown/typo role string can't be minted, and add a comment cross-referencing the UPDATE rule so the two stay in sync. Deploy with `~/.npm-global/bin/firebase deploy --only firestore:rules` — and per the repo's "re-diff before whole-file deploy" rule, `git diff firestore.rules` immediately before deploying so a concurrent session's edits don't ship with it.

2) Client, defense in depth — filter 'president' out of every role picker unless the actor is the President. Three call sites, all currently `Object.entries(ROLES).map(...)`:
   - js/screens/people.js:506 (`#inv-role`, Invite Team Member)
   - js/screens/dashboards.js:5338 (`#emp-role`, Add Employee Profile)
   - js/screens/dashboards.js:5420 (`#cw-role`, Create Worker Account)
   Add one shared helper next to the other role helpers in js/app.js, e.g.
     window.assignableRoles = function () {
       return Object.entries(window.ROLES || {})
         .filter(([k]) => k !== 'president' || (typeof isPresident === 'function' && isPresident()));
     };
   and replace each `Object.entries(ROLES)` with `assignableRoles()`. (Create Worker Account should arguably narrow further — an HR-managed worker account has no business being minted as manager/secretary/finance — but that is a separate hardening call for Neil.)

3) Audit trail: add `window.logAudit && window.logAudit('create','users',uid,{ role })` after the users .set() in js/screens/people.js (~:556) and js/screens/dashboards.js (~:5493), so any future role assignment at account-creation time is recorded the way payroll creation already is.

4) Verify no president doc was already minted this way before the fix ships: one-off check for users docs with role=='president' whose uid is not the owner's — `neilbarro870@gmail.com` should be the only one.

5) Bump nothing by hand — the pre-commit hook handles APP_VERSION / CACHE_VER for the JS edits.

### F56 — Tapping a chat push notification while a thread is open builds a second #chat-thread-panel whose composer is wired to the dying old panel — Send never enables and the message list is usually blank

**What is true**

CONFIRMED by my own read of the tree; all three lenses agree and I found nothing that refutes the mechanism.

Chain, verified line by line:
1. js/notifications.js:143-149 — `_navigateFromNotif('chat_message', …)` calls `navigateTo('chat')` then `window.Chat.openConversation(chatId)`.
2. js/app.js:2326 — `navigateTo` runs `Overlay.clearAll()`.
3. js/config.js:1255-1259 — `clearAll()` only pops `_stack` and invokes each `teardown()`; it removes no DOM itself.
4. js/app.js:3860-3862 — openPage's teardown splices the panel out of `window._pageStack` immediately but defers the node removal: `setTimeout(() => { if (p.isConnected) p.remove(); }, 300)`. It does NOT strip `p.id` or any child id. (I grepped: no `removeAttribute('id')`, no `p.id = ''`, and the only `querySelectorAll('.page-panel').forEach(el => el.remove())` is js/app.js:92, a logout-time reset, not on this path.)
5. js/chat.js:1112-1119 — `_buildThreadPanel`'s in-place-swap guard is derived purely from the now-empty stack (`alreadyOpen = stack.length > 0 && stack[stack.length-1].id === 'chat-thread-panel'`), so it PUSHES a second panel. js/app.js:3809 `document.body.appendChild(p)` puts it AFTER the still-connected dying one, so `document.getElementById` (first in tree order) resolves to the OLD node for every duplicated id.
6. js/chat.js:1193-1197, 1143, 1550 — `chat-file`, `chat-camera`, `chat-file-preview`, `chat-input`, `chat-send`, `chat-panel-back`, and the `chat-thread-scroll` scroll listener are all unscoped `document.getElementById`, captured once into the closure and never re-resolved.

Consequence, as verified: the visible panel's `<button id="chat-send" disabled>` (js/chat.js:1100) is born disabled, and the only thing that ever clears it is `updateSendState()` (js/chat.js:1214), closed over the OLD button. `input.addEventListener('input'|'keydown')` (js/chat.js:1511, 1518) and `sendBtn.addEventListener('click', doSend)` (js/chat.js:1535) are all on the dead node too — so typing in the visible textarea fires nothing, Enter inserts a newline, and Send stays greyed for the panel's entire life. No error is surfaced. The visible back chevron (`#chat-panel-back`) is unwired as well; escape needs OS back / Esc / swipe (the generic `.page-panel-back` IS scoped via `p.querySelector`, but CSS hides it for this panel — css/styles.css:4479).

Two corrections to the finding, neither of which lowers it:
- Trigger. The finding cites the in-app bell dropdown; the reach lens is right that that path is not reachable with a thread open (css/styles.css:3106 hides `.notif-panel` under 768px, and on desktop it sits at `--z-panel:150` under the panel's `300 + …` z-index from js/config.js:1189). The genuinely reachable trigger is the FCM push tap: firebase-messaging-sw.js:107-128 does `client.focus()` then `postMessage({type:'PUSH_NAV', chatId, …})`, received at js/notifications.js:1023 → `_navigateFromNotif`. That is the ordinary way staff open a chat notification after backgrounding the app with a thread still on screen — including a push for the SAME conversation, which nothing suppresses.
- Timing. `openConversation` is `async` and, with no `preloaded` arg, awaits `db.collection('conversations').doc(convId).get()` (js/chat.js:1698-1702) before `_buildThreadPanel`, so this is a race with the 300ms timer, not the guaranteed same-tick overlap "synchronously" implies. It is a race the app loses in the normal case: Firestore offline persistence is enabled (js/firebase-config.js) and the inbox listener (`_attachInbox`, js/chat.js:1706-ish `where('participants','array-contains',uid)`) has the conv doc cached, and a default-source `get()` resolves off a cached snapshot in ~a tick — well inside 300ms. Timer throttling on a just-refocused tab only widens the window (the finder measured ~1.9s).
- Split certainty. Dead composer is DETERMINISTIC once the two panels coexist. The blank message list additionally requires the first messages snapshot to land inside the same window: if it does, `_lastRenderOrder` is set from a render painted into the old node, and every later snapshot takes the `canPatch` prefix path (js/chat.js:4938) → `_patchThread` (js/chat.js:2745-2777) finds no `.ms-row` in the fresh empty scroller and appends nothing, so the pane stays empty permanently. If it lands after removal, `_lastRenderOrder` is still null (reset in teardownThread, js/chat.js:253) → full rebuild → list renders fine. Worst realistic case: a genuinely new inbound message appends one lone bubble into an otherwise-empty pane, which reads as lost history.

Not money, not security. It is a total silent functional break of the employee's most-used surface on a routine flow, with no error and a non-obvious recovery — high.

**Fix**

Two parts, both in scope of the chat/window modules. No firestore.rules change. Bump `window.APP_VERSION`/`CACHE_VER` per the repo rule (pre-commit hook handles it).

PART 1 (primary, low risk) — stop `_buildThreadPanel` and the thread helpers from doing document-wide id lookups. `_threadPanelEl = p` is already assigned at js/chat.js:1120, BEFORE all the wiring, so a scoped resolver is a drop-in.

In js/chat.js, near the other module-scope helpers (above `teardownThread`, ~line 240), add:

    // Two thread panels can briefly coexist: navigateTo -> Overlay.clearAll()
    // runs the old panel's teardown (splicing _pageStack at once) but openPage
    // defers the node removal ~300ms (js/app.js), and the new panel is
    // appendChild'd AFTER it — so document.getElementById returns the DEAD one.
    // Every thread-panel lookup must go through here.
    function _tq(id) { return _threadPanelEl ? _threadPanelEl.querySelector('#' + id) : null; }

Then, inside `_buildThreadPanel` (js/chat.js ~1119-1560), replace every `document.getElementById('chat-…')` that targets a node inside the thread markup with `_tq('…')`. Concretely at least: `chat-panel-back` (1143), `chat-info-btn` (1150), `chat-search-btn` / `chat-search-close` / `chat-search-prev` / `chat-search-next` / `chat-search-input-thread` (1156-1170), `chat-file` / `chat-camera` / `chat-file-preview` / `chat-input` / `chat-send` (1193-1197), `chat-attach-toggle` / `chat-attach-expand` (1220-1221), and the `chat-thread-scroll` scroll-listener bind at 1550 and 1552. Do the same in the thread-lifetime helpers that currently use `document.getElementById('chat-thread-scroll')`: js/chat.js:278 (teardownThread — runs before `_threadPanelEl = null` at the end, so `_tq` is still valid), 1637 (`_onViewportResize`), 1666, 1833, 2929, 3820, 3889, 3941, and 4928 (`_renderThread`). Same for `chat-pending-tail` in `_patchThread` (js/chat.js:2772) — scope it to the passed-in `el` (`el.querySelector('#chat-pending-tail')`) rather than the document.

Do NOT rewrite the `chat-about-*` / `_openMediaTab` lookups — those live in a separate pushed page, not in `_threadPanelEl`.

PART 2 (hardening, prevents the whole class) — retire the dying panel's identity so no stale `document.getElementById` anywhere can ever hit it. In js/app.js's openPage `teardown` (around line 3860, right beside `stack.splice(idx, 1)` and before the 300ms `setTimeout`), strip the CHILD ids while keeping `p.id` itself intact (css/styles.css keys `#chat-thread-panel`'s head-hide, notch inset, two-pane left offset and `.messenger-body` override off that id, and it is still needed for the 300ms exit animation):

    // The node lives ~300ms past teardown for the exit animation. Any id it
    // still carries out-ranks a replacement panel appended after it, because
    // getElementById returns the FIRST match in tree order — so retire the
    // child ids now. p.id stays: the exit animation's CSS is keyed off it.
    try { p.querySelectorAll('[id]').forEach(n => { n.dataset.deadId = n.id; n.removeAttribute('id'); }); } catch (_) {}

Then also stamp the panel itself as dead so the swap guard can't be fooled — in js/chat.js:1113 change the guard to ignore a retired panel:

    const top = stack[stack.length - 1];
    const alreadyOpen = !!top && top.id === 'chat-thread-panel' && top.isConnected;

Verification: with the app served (`npx serve -p 3838 .`), open a thread, then from the console simulate the push route — `navigateTo('chat'); Chat.openConversation('<otherConvId>')` — and assert `document.querySelectorAll('#chat-thread-panel').length`, that the visible panel's `#chat-send` enables on typing, and that the message list paints. This also fixes the sibling case the maintainers already documented at js/app.js:3711-3719 (thread + lightbox open, notification for a different conversation), which reaches the identical duplicate-panel state.

### F58 — payslips rule compares workerId (a worker_profiles docId) to auth.uid, so a Type-B worker's own payslip query is denied — and the un-caught rejection blanks the entire Finance half of their only screen the moment Finance issues their first payslip

`SECURITY`

**What is true**

Confirmed by my own reads; all three lenses were right and I follow none of their refutations because none refuted it — their two corrections are real and I fold them in.

Mechanism (verified verbatim, current tree, `git diff --stat HEAD` on all three files is empty): firestore.rules:1627-1631 grants payslip read on `resource.data.get('workerId','') == request.auth.uid || resource.data.get('linkedUid','') == request.auth.uid || isFinanceOrAdmin()`. Payslips are written by `collectPayslipData` (js/screens/hr.js:4283) with `workerId: profile.id` (js/screens/hr.js:4331-4332) — the worker_profiles auto-ID (js/screens/hr.js:2909: `const profileId = profile?.id || db.collection('worker_profiles').doc().id;`), never an auth uid. `linkedUid` is written only onto worker_profiles (js/screens/hr.js:3035 → :3039 `worker_profiles.doc(profileId).set(...)`); I checked every payslips writer (hr.js:3418/3474/3589/4161/4962) and none writes it, so that branch is dead exactly as its own comment at firestore.rules:1625 concedes. Both owner branches are therefore unsatisfiable for a worker; `isFinanceOrAdmin()` is president/manager/secretary/finance (firestore.rules:22). Result: permission-denied on js/screens/worker.js:1164.

The asymmetry is the root cause: firestore.rules:382-390 defines `isLinkedWorkerUid(workerId)` (get worker_profiles/{workerId}, compare linkedUid, require status != inactive) and wires it into `/attendance_worker/{workerId}` and its `records/{date}` child — but never into `/payslips/{docId}`. So the worker resolves their profile (firestore.rules:1636-1639 allows it), the calendar and clock card work, and only the money reads die.

Blast radius: js/screens/worker.js:1157-1166 is a bare `Promise.all`; the payslips `.get()` at :1164 is its only member without a per-promise catch, so it rejects the whole thing and the catch at :1167-1175 overwrites `#wb-finance` — the entire finance half (js/screens/worker.js:1299 `<div id="wb-finance"></div>`, loaded unconditionally at :1316-1320) — with one "Could not load finance data" card whose Retry rebinds the identical denied query. Reachable and inescapable: js/app.js:1323 `isTypeBWorker()` keys off the HR-settable `payClass === 'production'`, js/app.js:2384 routes dashboard → `renderWorkerHome`, and the workerB bottom nav (js/config.js:613-616) is Home/Chat/Profile only.

Corrections I accept (neither reduces severity): (1) "one rejection rejects all four" overstates — only :1164 rejects; `window.payslipYtdWeekly` (js/screens/hr.js:4555-4556) swallows the same denial with `.get().catch(()=>({docs:[]}))` and resolves to zeros. That is the finding's own corollary already latent: fix the Promise.all alone and a worker with 20 weekly payslips sees "YTD Net ₱0.00" with no error. (2) "no hours" is wrong — the attendance calendar is a separate card with its own try/catch and permitted `attendance_worker` reads, so Present/Absent and monthly hours survive. What is lost is the peso half: week estimate, YTD Gross/Net, recent-payslip list, payslip viewer. (3) Not unconditional: list rules evaluate per returned doc, so a worker with zero payslips gets an empty snapshot and the card renders fine — the section goes dark on the first issued payslip, i.e. precisely when it matters. Not an index problem: the workerId ASC + createdAt DESC composite exists at firestore.indexes.json:84-91.

Classified security=true because the defect is in the rules boundary and the fix widens read access (it must be scoped, not blanket-opened); it is over-restriction, not exposure. money=false — no peso figure is currently mis-stated and nothing mis-posts; this is availability/transparency (a worker cannot verify a deduction in-app, the screen's stated purpose).

**Fix**

Three edits; the rules edit is the actual fix, the JS edits stop one denial from nuking a section and stop a denial from rendering as ₱0.00.

1. firestore.rules — `match /payslips/{docId}` (~line 1620-1634). Route ownership through worker_profiles instead of comparing workerId to auth.uid. Add a status-free sibling of the existing helper next to `isLinkedWorkerUid` (firestore.rules:382-390) so an offboarded worker can still read historical payslips (DOLE) even though they can no longer punch:

    function isLinkedWorkerProfile(workerId) {
      return workerId != ''
        && exists(/databases/$(database)/documents/worker_profiles/$(workerId))
        && get(/databases/$(database)/documents/worker_profiles/$(workerId)).data.get('linkedUid','') == request.auth.uid;
    }

then in the payslips block replace the two dead owner branches with:

    allow read: if isAuth() && (
      isFinanceOrAdmin() ||
      isLinkedWorkerProfile(resource.data.get('workerId', ''))
    );

Keep create/update = isFinanceOrAdmin and delete = isPresident unchanged. Update the stale comment at firestore.rules:1620-1625 (it currently asserts linkedUid is "harmless if never written" — it is written nowhere, which is the bug). Note the get() is on one identical path for every doc in a single-worker query, so it is cached and counts once against the rules access-call budget; keep the `.limit(5)` on the dashboard query and add a bounded limit to payslipYtdWeekly if it ever goes cross-worker.

2. js/screens/worker.js — `_loadWorkerFinance` (lines 1156-1175). Give each promise its own catch so no single failure blanks `#wb-finance`: change the payslips member at :1164 to `.get().catch(e => { payslipErr = e; return { docs: [] }; })` (declare `let payslipErr = null;` above), and have the YTD member resolve to `null` on failure rather than zeros. Render per-card degradation: inside the "Recent Payslips" card body show "Couldn't load your payslips — Retry" when `payslipErr`, and in the Month & YTD card render "—" (not ₱0.00) with a muted "unavailable" note when `ytd == null`. Keep the outer try/catch only as a last-resort guard.

3. js/screens/hr.js — `window.payslipYtdWeekly` (lines 4554-4556). Stop laundering a permission-denied into zeros: replace `.get().catch(()=>({docs:[]}))` with a catch that flags the failure, e.g. return `{ gross: 0, net: 0, thirteenthAccrual: 0, error: true }`, and have callers (worker.js finance card and the HR payslip YTD card) render "—" when `error` is set instead of a confident ₱0.00.

4. Optional belt-and-braces, not a substitute for (1): in `collectPayslipData` (js/screens/hr.js:4331) also write `linkedUid: profile.linkedUid || ''` so the existing rule branch becomes live for new payslips, and re-stamp it when HR changes a profile's linked uid (hr.js:2950-3039). Existing payslips have no such field, so the rules fix is what makes this work retroactively.

Deploy: `firebase deploy --only firestore:rules` (CLI at ~/.npm-global/bin/firebase; git push does NOT ship rules). Re-`git diff firestore.rules` immediately before deploying — concurrent sessions edit this tree. The JS edits get their CACHE_VER bump from the pre-commit hook. Verify with a Type-B account that has at least one issued payslip; the pre-fix repro is "issue one payslip, reload the worker Home".

### F60 — Queued-punch replay re-uploads the selfie to a fixed, queuedAt-keyed Storage path; after a partial first attempt the overwrite is denied (storage/unauthorized), matches neither error classifier, and jams that device's offline punch queue permanently

`MONEY`

**What is true**

Confirmed by direct read of the working tree; all three lenses (code, reach, effect) agree and none refuted it, and I re-verified each cited line rather than taking their word.

Mechanics, all present verbatim: js/screens/worker.js:576 builds the replay upload path from `item.recordDateStr`/`item.kind`/`item.queuedAt`, every one of which is frozen at queue time, so the path is byte-identical on every replay attempt. `selfieUrl` at :574 is a plain local; the IndexedDB helper set is only `_pqOpenDb`/`_pqAdd`(:458)/`_pqGetAll`(:466)/`_pqDelete`(:474) — grep confirms no `_pqUpdate` and no write-back anywhere in the repo — so a successful upload can never be remembered. storage.rules:133-137 gives the worker `create` only (`allow update, delete: if isSignedIn() && isAdminClaim()`, and isAdminClaim = president|manager at storage.rules:98-100), so a second `put()` to the now-existing object is an *update* and fails `storage/unauthorized`. That code escapes both classifiers: `_isNetworkish` (:507-513) tests /unavailable|deadline-exceeded|retry-limit-exceeded|network/ on the code and /network|offline|failed to fetch/ on the message — the Firebase Storage unauthorized error matches neither; `_pqIsPermanentRejection` (:524-529) strips only a leading `functions/`, so the code stays `storage/unauthorized` and is absent from the allowlist. Neither branch fires, so control reaches the unconditional `break` at :678 and the head item is retained. Because the jam happens at the Storage step, the callable is never reached, so the server's own >48h "queued-punch-too-old" permanent rejection (functions/index.js recordAttendancePunch) — the one mechanism that would otherwise drop the item — never gets a chance to run. There is no age prune, no attempt cap, and no server sweeper. The queue is a device-local IndexedDB store, so it is a per-device jam, permanent until IndexedDB is cleared by hand.

Trigger is realistic, not theoretical: any replay where `sref.put()` lands but the following `getDownloadURL()` (:579) or the `recordAttendancePunch` callable (:581) fails transiently — precisely the flaky-reconnect conditions under which `_pqReplayAll` runs (it fires on the 'online' event at :687 and again on every renderWorkerHome load at :1269, which can also overlap and double-PUT the same path). The codebase already names this exact bug class and fixed it in the LIVE punch path — worker.js:900-904, "Workers have create-only (admin-only update) on this Storage path; a fixed name meant a partial retry after an upload landed but the later write failed turned every retry into a denied UPDATE" — with a per-attempt `Date.now()` suffix at :904. The replay path was simply left un-fixed.

Reachability is live: payClass 'production' routes to renderWorkerHome (js/app.js:1323, :2384), the screen renders the TIME IN/OUT buttons (worker.js:388/397), and the offline branch queues with `selfieUrl: null` (:492, :906).

Corrections to the finding as written, none of which weaken it: (1) items are deleted in two places, :591 on success and :652 on permanent rejection, not just :591; (2) the day is not fully silent — the advisory `pendingPunch` marker makes that day's clock card render a stuck "Syncing…" badge (worker.js:334-341); (3) the *effect* is worse than "days stop appearing" in one respect and narrower in another. Narrower: only queued (offline) punches jam — ordinary online punches still succeed via the unique-name live path. Worse: on the jammed day the pendingQueuedIn/Out branches (worker.js:365-386) render NO punch button at all, so the worker cannot even re-punch that day; and in HR's Load Kiosk Hours the jammed day-doc exists but carries no `needsReview`/`hoursWorked`/`timeIn`, so hr.js:4101-4108 pushes it into `loaded`, not `flagged` — HR gets a clean "Loaded kiosk hours" toast and pays 0 hours for a day the worker demonstrably stood on-site for. At a ₱610/day production rate that is ₱610 gross per jammed punch, compounding for every subsequent offline punch behind the stuck head item. High, not critical: it requires a partial-failure first attempt rather than firing on every punch, and it is a data-loss/pay defect, not an access-control breach (no privilege escalation or exposure — the rules are behaving as designed; the client misuses them).

**Fix**

All edits in js/screens/worker.js (bump APP_VERSION/CACHE_VER via the normal commit hook).

1. Unique path per attempt in `_pqReplayAll` (:576) — mirror the live path's fix at :904. Replace
   `const path = \`attendance-selfies/${currentUser.uid}/${item.recordDateStr}-${item.kind}-${item.queuedAt}.jpg\`;`
   with a per-attempt suffix that still carries the queue identity, e.g.
   `const path = \`attendance-selfies/${currentUser.uid}/${item.recordDateStr}-${item.kind}-q${item.queuedAt}-${Date.now()}.jpg\`;`
   `item.queuedAt` must stay in the callable payload (:588) — this changes only the object name, never the recorded punch time.

2. Persist the URL back so a landed upload is never re-attempted. Add a `_pqUpdate(record)` helper next to `_pqAdd` (:458) using `tx.objectStore(WB_PQ_STORE).put(record)` (the store's keyPath is 'id', so put() upserts). In `_pqReplayAll` right after `selfieUrl = await sref.getDownloadURL();` (:579), call `await _pqUpdate({ ...item, selfieUrl, selfieBlob: null }).catch(() => {});` — dropping the blob once the URL is durable also reclaims IndexedDB space. Update the PENDING-PUNCH SHAPE comment block (~:432-441) to name `_pqUpdate` as the third mutator.

3. Normalize Storage error codes in both classifiers so no storage error can be silently un-classified. In `_pqIsPermanentRejection` (:525) widen the strip to `.replace(/^(?:functions|storage)\//, '')` and add `'unauthorized'` (and optionally `'quota-exceeded'`, `'invalid-argument'` already present) to the allowlist; in `_isNetworkish` (:511) add `storage/retry-limit-exceeded` and `storage/canceled` to the transient side (the existing `retry-limit-exceeded` alternative already matches once the prefix is stripped — apply the same strip there for clarity).

4. Add a safety valve so no future unforeseen error can jam the queue forever. Give each record an `attempts` counter (or reuse `queuedAt` for age): in the `break` branch (:670-678), before breaking, `_pqUpdate({ ...item, failCount: (item.failCount || 0) + 1 })`; when `failCount` exceeds ~10 or `Date.now() - item.queuedAt > 48*3600e3` (matching the server's own too-old cutoff), take the same exit as the permanent-rejection branch — `_pqDelete`, write the client-side `attempts` audit note to the day-doc (the :654-664 shape), clear the advisory `pendingPunch` marker on that doc, show the error toast, and `continue`. That converts a silent permanent jam into a visible "could not be submitted — ask HR to enter this day" event.

5. Concurrency guard: `_pqReplayAll` is invoked from both the 'online' listener (:687) and every renderWorkerHome load (:1269), which can overlap and double-PUT. Wrap the body in a module-level `let _pqReplaying = false;` re-entrancy check (`if (_pqReplaying) return; _pqReplaying = true; try { ... } finally { _pqReplaying = false; }`).

6. Optional, HR-side (js/screens/hr.js ~4100): treat a day-doc that has `pendingPunch` but no `timeIn` as `flagged` rather than `loaded`, so a stuck offline punch surfaces in the "needs review before paying" list instead of being paid as a clean 0-hour day.

### F61 — Blank `company` on a partner invite flips the quote builder into Brilliant-Steel mode: the internal Cost & Margin panel is not removed, and the partner's quotes go out on BRILLIANT STEEL letterhead

`SECURITY`

**What is true**

The mechanism is confirmed exactly as reported. js/app.js:1329 defines generic-partner by department (`isPartner() && !currentDepts.includes('Brilliant Steel')`), but js/app.js:1798 hands the builder `pcoName: (p.company || 'Partner')`, and quote-builder-v2.html:1748 re-derives it from that string: `GENERIC_PARTNER = PARTNER_MODE && !!PARTNER_CO_NAME && PARTNER_CO_NAME !== 'Partner'`. `'Partner'` is simultaneously the app's fallback value and the builder's sentinel for "not generic", so a blank `company` (optional, unvalidated — js/screens/people.js:509-510, 527, 550) makes GENERIC_PARTNER false. applyPartnerMode() (quote-builder-v2.html:1760-1797) then skips its only removal site (:1788-1791 `btnInternal` / `costMarginWrap`), and `setCompany(GENERIC_PARTNER ? 'PT' : 'BS')` (:1816, :1821) plus the hidden Barro Kitchens toggle (:1776-1779) brand the session Brilliant Steel. The partner reaches the builder via the genericPartner nav (config.js:516) and app.js:2402, ungated.

The "reach" and "effect" lenses refuted the consequence on one shared premise: that the cost panel can only ever render zeros. I did not follow them, because the premise is not established by the code. They are right that `product_costs` is skipped for every PARTNER_MODE session (quote-builder-v2.html:1640) and rules-denied to partners (firestore.rules:1148-1149). But the read path has an explicit legacy fallback — `capitalMaterials: (c && c.capitalMaterials) ?? p.capitalMaterials ?? 0` (:1666) — off the `products` doc, which is still `allow read: if isAuth()` (firestore.rules:1129), and the migration that strips those fields, `window.migrateProductCostsOut` (js/migrations.js:417), is president-run from the console with no caller anywhere in the app and, per its own comment at js/migrations.js:448-452, "no dedicated button exists yet." Until it is run against production, a partner session loads real per-product capital costs, and this bug renders them. Second live path, independent of migration state: saveReviewedPartnerQuote (js/app.js:1906, 1909) writes the president's `payload.items` and `editableState.items` — which carry `capitalMaterials`/`capitalLabor` (quote-builder-v2.html:2559, 2879, 4507, 4535) populated from the president's cost-bearing session — straight onto the partner-owned bs_quotes doc, which the partner may read (firestore.rules:986-989). Reopening that quote puts Barro's real cost basis in the partner's `items`, and computeMarginSummary (:3512-3540) prints materials, COGS and gross-margin %.

So the finding's headline is overstated only in scope ("every quote" → any quote whose items carry non-zero capital), not in kind. Correctly downgraded elements: this is not a rules-layer privilege escalation, and the residual `products` legacy exposure is equally console-readable by a correctly-configured partner — the incremental harm here is that it is surfaced in the UI with no console work. Correctly upgraded element neither refuter weighed: the same root cause unconditionally letterheads an unaffiliated partner's client-facing quotations as BRILLIANT STEEL CORPORATION with their own company name and the Barro Kitchens option removed. That alone is a real, client-visible defect on every quote they send.

**Fix**

Four edits, the first is the actual fix.

1. Stop deriving identity from an overloaded string. In `renderQuoteBuilderIframe` (js/app.js:1794-1801) add an explicit flag to the URLSearchParams — `pcoGeneric: '1'` — alongside the existing pcoName/pcoContact/pcoSig, and change quote-builder-v2.html:1748 to `const GENERIC_PARTNER = PARTNER_MODE && _PQ.get('pcoGeneric') === '1';`. Keep the CO.PT branding block (:1749-1759) gated separately on `PARTNER_CO_NAME` being non-empty, and when it is empty fall back to `p.displayName` (or a neutral "Partner Company") for `CO.PT.name` so the letterhead never resolves to Brilliant Steel for a non-BS partner.

2. Make the removal fail-closed, so a future misconfiguration degrades safely. Rewrite quote-builder-v2.html:1788-1791 to remove `#btnInternal` and `#costMarginWrap` for EVERY `PARTNER_MODE` session, and re-admit them only on a positive Brilliant-Steel signal (a `pcoBS=1` flag set in app.js from `isBrilliantOnly()` / BS-department membership) rather than on the absence of a generic signal.

3. Close the invite hole. In js/screens/people.js, extend the validation next to the existing `if (!email) {...}` guard (:527) so `company` is required when `invRole.value === 'partner'` and the user is not being put in the Brilliant Steel department; keep the trim at :550. Backfill existing partner users whose `company` is blank.

4. Stop shipping cost fields into partner-readable docs (independent of this bug, but it is what makes the panel dangerous). In `saveReviewedPartnerQuote` (js/app.js:1892-1923) strip `capitalMaterials`/`capitalLabor` from `payload.items` and `payload.editableState.items` before the `bs_quotes` update at :1923. And run `window.migrateProductCostsOut()` (js/migrations.js:417) against production, then wire the button its own comment says is still missing, so the `?? p.capitalMaterials` legacy fallback at quote-builder-v2.html:1666 has nothing left to read.

### F63 — firestore.rules /users has a bare `allow read: if isAuth()` — an external partner account can list the entire staff directory (name, email, phone, employeeId, role, departments); the partner-only filter is client-side JS

`SECURITY`

**What is true**

Confirmed at the rules layer, which is the boundary that matters. firestore.rules:131-132 is `match /users/{uid} { allow read: if isAuth(); }` — the only `match /users` block in the file, with no `allow list` narrowing (create :137, update :197, delete :209 are the only other rules). Firestore `read` covers both get and list, so an authenticated partner's unfiltered `db.collection('users').get()` is permitted. This is the sole outlier: 95 of the 106 `allow read` rules in the same file carry `!isPartner()`, and the helper `isPartner()` exists at :29 — it was simply never applied here.

Reach is fully open, not theoretical: js/app.js:1343-1345 resolves every partner into the `genericPartner` or `partnerBS` nav bucket; both carry the Team item (js/config.js:518 and :529, no `when:` predicate); js/app.js:2415 routes `team-directory` to `renderTeamTab` with no role gate; js/screens/people.js:415-416 fetches the whole collection; and js/screens/people.js:426-431 applies `if (viewingAsPartner) return u.role === 'partner'` — a JS filter that runs *after* the full snapshot has been delivered to the partner's machine. Same shape in the DM picker (js/chat.js:5038 → dmCandidates at :222-231); Chat is in both partner bottom navs. The rendered payload confirms the fields are live: js/screens/people.js:892-894 prints `u.email`, `u.phone`, `u.employeeId`.

All three lenses stand and I reproduced each of their citations. I follow both of their corrections. From the reach lens: the cache is not the vector — a partner can re-issue the query at any time, so removing `dbCachedGet` or the JS filter would change nothing; the fix must land in the rules. From the effect lens: pay and government IDs are genuinely NOT exposed (js/screens/hr.js:4969-4974 splits `tinNum/ssNum/phNum/pagibigNum` into `payroll`, gated at firestore.rules:814-816), and `phone` only exists for staff who set it (js/screens/people.js:548, js/app.js:2947/3164/3179 write it; the HR worker-creator at js/screens/dashboards.js:5481 does not). The exposure is therefore the internal org chart plus contact details, not payroll — still the claimed harm, so severity stays high rather than critical.

Minor corrections to the finding's citations, none material: the Team nav entries are js/config.js:518 and :529 (not 528 — that is `clients`); the people.js fetch is :415-416 (not :411-413); and the users doc is authenticated-readable, not literally "world-readable" as the comment at js/config.js:622 puts it. One scoping note the finding understates: the rule grants the directory to EVERY authenticated principal, so any compromised low-privilege account reads it identically — partner is just the sharpest case because the UI pretends to hide it. One thing that does NOT block the fix: `getRole()` (firestore.rules:29) uses a rules-side `get()`, which bypasses rules, so tightening the read gate cannot break role resolution.

**Fix**

Two coordinated edits; the rules edit alone would break the partner Team tab and DM picker, so both must ship together.

1) firestore.rules — split the read at line 132 inside `match /users/{uid}`:

    allow get:  if isAuth();
    allow list: if isAuth() && (!isPartner()
                  || resource.data.role in ['partner','president','manager']);

Keeping `get` open preserves every uid-to-name single-doc lookup across chat/tasks/posts while removing enumeration. Verify the `list` clause in the Rules Playground / emulator before deploying: Firestore only accepts a query-constrained list if it can prove the query implies the condition. If the `in`-list form is rejected, fall back to the definitely-supported equality form `resource.data.role == 'partner'` and source the president/manager DM entries from a small curated doc (e.g. `config/chat_directory`) instead of a users query.

2) js/config.js — `window.fetchUsersWithPayroll` (~line 628). Branch the users query on role so it emits the constrained query for partners:

    const usersQ = (typeof isPartner === 'function' && isPartner())
      ? db.collection('users').where('role','in',['partner','president','manager']).get()
      : db.collection('users').get();
    const [uSnap, pSnap] = await Promise.all([usersQ, db.collection('payroll').get().catch(() => ({ docs: [] }))]);

Because `dbCachedGet` force-substitutes this fetcher for the `'users'` key (js/config.js:657-659), this single edit corrects every cached call site at once: js/screens/people.js:415, js/chat.js:2074/2278/4623/5038, js/screens/tasks.js:810/1018/1150, js/screens/design.js:767/948/1180/1243, js/departments.js:4228, js/screens/approvals.js:733, js/screens/dashboards.js:938/1185/1324/2193/4011, js/screens/hr.js:2921, js/bir.js:697.

3) Sweep the direct, non-cached unfiltered gets so a partner hitting one fails soft instead of throwing an unhandled permission-denied: js/config.js:436, js/app.js:2227, js/drive.js:385, js/notifications.js:632, js/svc-approvals.js:39, and the `: await db.collection('users').get()` fallback branches at js/screens/people.js:416/1208/1749/1885/2147 and js/screens/dashboards.js:4012. Route them through `window.fetchUsersWithPayroll` (or add `.catch(() => ({ docs: [] }))`). Admin-only paths are functionally fine either way, but should not throw for a partner who reaches them.

4) Keep the client-side filters in renderTeamTab and dmCandidates — they are now defense-in-depth rather than the only control.

5) Deploy: `~/.npm-global/bin/firebase deploy --only firestore:rules` (git push does NOT deploy rules). Re-run `git diff firestore.rules` immediately before deploying so a concurrent session's uncommitted rules edits are not shipped. `where('role','in',[...])` is a single-field query, so no composite index is needed. Smoke test with a real partner account: Team tab still lists partners, Chat new-DM picker still lists same-company partners plus president/manager, and `(await db.collection('users').get())` in the console now returns permission-denied.

### F64 — Publishing an internal post fans a notification carrying the post's title/first-40-chars into every external partner's inbox and phone, defeating the !isPartner() lock on `posts`

`SECURITY`

**What is true**

STANDS. I re-read every hop rather than trusting the three refuters, and the chain is intact end to end.

SENDER: `js/screens/people.js:339` `openNewPostModal` is the only definition (modules.js:50 merely names it in a stale comment; index.html:576 loads `js/screens/people.js`, sw.js:76 precaches it). At :358 `status = publishDirectly ? 'published' : 'pending'`, and :374-375 fires `Notifs.sendToAll({title:'📣 New Post', body:`${displayName} posted: ${title || content.slice(0,40)}`, type:'post'})` UNCONDITIONALLY — the `dept` read at :358 is written to the post doc but never consulted for the broadcast. The dept picker offers General plus every entry of `window.DEPARTMENTS` (:344-345), so a Finance/HR/Gov-Biddings post takes the same path.

FAN-OUT: `js/notifications.js:631-646` `sendToAll` does a bare `db.collection('users').get()` and batch-sets `notifications/{doc.id}/items/{docId}` for EVERY user doc — no role or dept predicate anywhere. Contrast `sendToDept` at :583-590, which does filter. `firestore.rules:132` `allow read: if isAuth();` on `/users/{uid}` means that get() really does return partner docs, and `isPartner()` (rules:29) keys off `users/{uid}.role`, so partners are ordinary members of that collection.

WRITE IS ALLOWED: `firestore.rules:298-336` — cross-user create is deliberately open; the constraints are only a `hasOnly` field allowlist (which exactly matches what sendToAll writes), `read == false`, `createdAt == request.time`, and length caps (title 200 / body 2000). Nothing scopes the recipient's role.

RECIPIENT: `js/app.js:181-182` runs `Notifs.startListener(uid)` and `Notifs.initPush(uid)` for every role — only `checkAttendanceReminder` at :184 is partner-gated. The listener is an unfiltered `.orderBy('createdAt','desc').limit(30).onSnapshot`, and `js/notifications.js:337` renders `escHtml(n.body)` verbatim. `functions/index.js:18-22` `sendPushOnNotification` is an unconditional onCreate on `notifications/{uid}/items/{itemId}`; its only early-returns are empty title+body (:37), sender quota (:70), and muted chat (:99). At :106-109 it just reads `users/{uid}.fcmToken` and at :110-131 emits a data-only push whose `body` the SW displays (firebase-messaging-sw.js:50-51,85). No partner check in either file.

The stale comment the finding cites is still there: firestore.rules:251-253 "the audit separately flagged that published-post NOTIFICATIONS also fan out to partners; that's a different, notification-side fix." Still unfixed. And rules:263-264 proves the intent — a partner is denied the post itself unless `dept=='Partners' && status=='published'` — so the notification body delivers exactly the text the read rule exists to withhold, plus a dead tap.

CORRECTIONS to the finding's scope (all three refuters flagged volume; I confirmed and go further):
1. "Every internal announcement headline" is wrong on volume, and I found the reason is worse than the refuters said. `_defaultDedupKey` (js/notifications.js:574-577) is `type|title|day` = `post|📣 New Post|<Manila date>`, and every published post reuses that same literal title, so `_dedupDocId` yields ONE deterministic doc id per Manila day. The reach and effect lenses both claimed later same-day posts "overwrite the doc and re-render live." That is incorrect: a `set()` on an already-existing doc is an `update` in Firestore rules, and rules:302 allows update only `if isAuth() && isOwner(uid)`. The president is not the owner of another user's inbox, so the second same-day broadcast is PERMISSION_DENIED, and because batched writes are atomic the WHOLE batch fails. So the accurate claim is: the FIRST published post of each Manila day leaks to every partner (in-app row + one OS push); posts 2..N that day deliver nothing to anyone. That is still a per-day confidential-headline leak to an external company, which is the harm the finding describes.
2. The fan-out is president-only: `canPost = isRealPresident()` (people.js:78, modules.js:43-45), and the manager approval path (people.js:224-225) publishes via `update({status:'published'})` and then calls only `Notifs.send(post.authorId, …)` — no broadcast. So approved employee posts do not leak.
3. The OS push additionally requires the partner to hold an `fcmToken` and have granted permission (iOS needs an installed PWA — js/notifications.js:741-744). The in-app inbox row is unconditional.

SECONDARY DEFECT surfaced by the same dedup collision, worth fixing in the same edit: that denied second-post batch rejects inside the un-try/caught click handler at people.js:355, so `closeModal()`, the "Post published!" toast, and `renderPosts()` at :379-381 never run — the post IS written but the president sees a stuck modal and no confirmation.

Severity high, not critical: confidentiality-only, one headline per day, external-partner audience, no write/privilege gain.

**Fix**

Three edits; the first is the security fix, the second and third stop the collision that both masks and corrupts it.

1. `js/notifications.js` — `sendToAll` (line 631). Exclude external partners by default. Change the signature to `async function sendToAll(notifData, opts = {})` and, right after the `users` fetch, filter the docs:
   `const docs = snap.docs.filter(d => opts.includePartners === true || d.data().role !== 'partner').slice();`
   (replacing the current `const docs = snap.docs.slice();`). Default-deny is safe: `sendToAll` has exactly one call site in the whole repo (grep confirms only people.js:375 plus the export at :1344), so nothing else regresses. Add a comment tying it to firestore.rules:251-253 so the two stay in sync.

2. `js/screens/people.js:374-375` — make the broadcast match the post's audience instead of blasting everyone. Replace the single `sendToAll` call with a dept-aware branch inside the `if (status === 'published')` block:
   - `dept === 'General'` → `Notifs.sendToAll(payload)` (now partner-free).
   - `dept === 'Partners'` → `Notifs.sendToDept('Partners', payload)` — this is the one case partners legitimately see, and rules:263-264 lets them open it.
   - any other dept → `Notifs.sendToDept(dept, payload)`, so a Finance headline reaches Finance only. This also closes the smaller sibling leak of an internal dept's headline reaching unrelated internal staff.
   Capture the `add()` result first (`const ref = await db.collection('posts').add({...})`) so the payload can carry `link` / a per-post dedupKey.

3. Same call site — give each post its own dedup identity so same-day posts stop colliding: pass `dedupKey: 'post|' + ref.id` in the payload. That makes every broadcast a fresh `create` (allowed by rules:307), which restores delivery for posts 2..N and eliminates the atomic-batch PERMISSION_DENIED. Wrap the `save-post-btn` handler body (people.js:355-381) in try/catch that toasts the error and still calls `closeModal()`, so a future broadcast failure can never again leave a published post behind a stuck modal.

4. `firestore.rules` — once (1)+(2) ship, delete the now-obsolete parenthetical at lines 251-253 and replace it with a note that the partner exclusion is enforced client-side in `Notifs.sendToAll`, because the notifications create rule cannot cheaply role-check the recipient (it would need a `get(/databases/$(database)/documents/users/$(uid))` per write and would wrongly block the legitimate partner notifications for quotes/projects). No rules redeploy is required for the fix itself — this is a comment-only change, so it can ride along with the next `firebase deploy --only firestore:rules`.

Bump `window.APP_VERSION` via the normal pre-commit hook (do not hand-edit `CACHE_VER`); both touched files are cached JS.

### F65 — firestore.rules users-create lets a secretary mint an account they control with role:'finance' or departments:['Finance'], handing them the money tier (payroll/ledger/journal writes) that WS19 exists to deny them

`MONEY` `SECURITY`

**What is true**

CONFIRMED at the rules layer, which is the only boundary that matters here. firestore.rules:137-140: `allow create: if isAuth() && ( isSeniorAdmin() || ( isAdmin() && request.resource.data.get('role','employee') in ['employee','agent','finance'] ) || ...)`. `isAdmin()` includes 'secretary' (:21). That branch has no uid predicate and no department predicate — the Finance/Design department freeze at :146-148 is syntactically inside the `isOwner(uid)` self-signup branch only. So a signed-in secretary may create a users doc at any doc-less uid carrying role:'finance' AND/OR departments:['Finance']. role:'finance' satisfies isMoneyAdmin() (:31); departments:['Finance'] satisfies isFinanceDept()→canFinance() (:43). Those two helpers are the sole gate on payroll/{uid} create+update (:816, live salary), salary_history (:825), salary_raises (:835), payroll_ca_overrides (:870), pay_runs create/compute/verify (:890-893), cash_advances create+approve (:477,:485), ledger (:1490,:1512), cash_receipt/cash_disbursement/general_journal (:1530,:1535,:1540 — no amount cap anywhere), finance_records, bank_accounts (:1611). Reach is genuine and does not depend on any UI: signup_requests create is fully public (:1079, unauthenticated), and two shipped flows call createUserWithEmailAndPassword from a secondary app with the committed public config (js/screens/people.js:531-534, js/screens/dashboards.js:5379/5476; js/firebase-config.js:20 exports window.firebaseConfig), so email/password client sign-up is provably enabled. syncUserClaims (functions/index.js:459-463, :492) then stamps role/dept custom claims onto the new account, extending the escalation into Storage. I also found a cleaner, race-free variant the finding missed: the secretary writes a placeholder users/<newDocId> = {email:'x@…', role:'finance', departments:['Finance'], pendingPasswordSetup:true} (same permissive create rule), then signs up with that email — createUserDocOnAuthCreate Path A (functions/index.js:215-227) copies the placeholder's role/departments verbatim onto users/{realUid}. No devtools timing race needed. I did NOT follow the reach lens's implied softening: it correctly showed the in-app buttons are gated to president/manager (people.js:391, dashboards.js:5248), but a rules-layer boundary is not defended by hiding a button, and the placeholder path above makes even the "devtools" framing partly moot. I DID follow both corrections that narrow the blast radius, and the title/severity reflect them: every money-tier DELETE stays President-only (:817, :1514, :1532/:1537/:1542, :489), and pay_runs 'disbursing'/'disbursed' is President-only (:894+), so the escalated account can fabricate and mutate pay and books but cannot erase records or complete a payout unassisted. That is books-integrity and insider-fraud harm requiring a President click to monetize — high, not critical. Note the allowlisting of 'finance' at :139 is deliberate (the comment says non-senior admins may onboard "finance-department hires"); the defect is that nothing binds that power to a real hire or blocks pointing it at an account the creator controls.

**Fix**

All in firestore.rules, `match /users/{uid}` create rule (lines 137-150).

1. Hoist the department freeze into a shared helper next to the other validators (near :128):

    function noPrivilegedDept() {
      return request.resource.data.get('department', '') != 'Finance'
          && request.resource.data.get('department', '') != 'Design'
          && !request.resource.data.get('departments', []).hasAny(['Finance','Design']);
    }

2. Rewrite the non-senior admin branch (:138-139) so it can neither mint the money role nor mint Finance/Design membership — move both to isSeniorAdmin():

    allow create: if isAuth() && (
      isSeniorAdmin() || (
        isAdmin()
        && request.resource.data.get('role', 'employee') in ['employee', 'agent']
        && noPrivilegedDept()
      ) || (
        isOwner(uid)
        && request.resource.data.role == 'employee'
        && noPrivilegedDept()
      )
    );

   Also apply noPrivilegedDept() at the isOwner branch (:146-148) via the helper so the two copies cannot drift.

3. Compatibility check — this costs nothing operationally. js/svc-approvals.js:44-50 (signupApprove, the only creation path a secretary can actually drive) writes role:'employee', departments:[] and passes unchanged. The "+ Invite Member" button (js/screens/people.js:391-399) and "Create Worker Account" (js/screens/dashboards.js:5256/5309) are already gated to president/manager, i.e. isSeniorAdmin, and keep full power. (Side note for a separate ticket: people.js:391 also shows Invite to role 'finance', which is neither isAdmin() nor isSeniorAdmin() — that click is already rules-denied today and is a pre-existing UI/rules mismatch, not a regression from this fix.)

4. Close the placeholder-laundering path server-side, in functions/index.js createUserDocOnAuthCreate Path A (:215-227): do not copy `role`/`departments` from a placeholder verbatim. Either coerce anything above the ordinary tier down (`const safeRole = ['employee','agent'].includes(p.role) ? p.role : 'employee'`, and strip 'Finance'/'Design' from p.departments) unless the placeholder records a senior approver, or require the placeholder to carry `approvedBy` whose users doc role is president/manager and validate that before honoring its role/departments.

5. Audit trail (addresses the "traces to nothing" half of the finding): require attribution on admin-created user docs — add `&& request.resource.data.get('createdBy','') == request.auth.uid` to the isAdmin()/isSeniorAdmin() create branches, and set `createdBy: currentUser.uid` in js/svc-approvals.js signupApprove's batch.set, js/screens/people.js:~531 invite flow, and js/screens/dashboards.js:~5476 worker-create flow. Ship rules with `firebase deploy --only firestore:rules` (CLI at ~/.npm-global/bin/firebase; re-diff first — git push does NOT deploy rules).

### F66 — WS19's money-tier narrowing never reached the Type-B leg: firestore.rules keeps payslips and worker_profiles create/update at isFinanceOrAdmin() (which includes 'secretary'), so a Corporate Secretary can set worker rates/allowances/CA balance and issue official weekly payslips with no President in the loop

`MONEY` `SECURITY`

**What is true**

Confirmed at the boundary, not just the UI. firestore.rules:22 isFinanceOrAdmin() literally lists 'secretary'; rules:1632 (payslips) and :1640 (worker_profiles) both keep `allow create, update: if isAuth() && isFinanceOrAdmin();`, while the WS19 comment at rules:24-31 says money-moving blocks must use isMoneyAdmin() (president/manager/finance). bank_accounts (rules:1610) got that narrowing; the Type-B pair never did, and worker_directory (rules:1651-1652) is likewise isFinanceOrAdmin() for create/update/delete. UI matches: js/departments.js:20 canEditDept returns true for 'secretary', js/departments.js:27 isFinancePriv() = canEditDept('Finance'), so js/screens/hr.js:2555 `const isPriv = isFinancePriv();` renders hrp-add-btn / hrp-raise-btn / hrp-edit-btn / hrp-del-btn / hrp-sync-dir-btn; the per-row hrp-gen-btn (payslip generator, hr.js:2603) is not gated at all. Reach is clean: js/app.js:1341 gives secretary the 'admin' nav variant, js/config.js:501 carries the HR item, js/screens/hr.js:351 explicitly admits 'secretary' to renderHR, and neither openHRProfileForm (hr.js:2756) nor openPayslipGenerator (hr.js:3627) has a role check. Code and reach lenses are right on the mechanism; I adopt the effect lens's two corrections because I reproduced them. (1) The headline ghost-worker exploit works (rate inputs exist only on the !isEdit branch, hr.js:2811-2812, written at hr.js:3000-3003), but the sharper exploit is editing a REAL worker: foodAllowance (hr.js:3004), allowances.meal/transport (3006-3008) and caBalance (3033, whose input at hr.js:2892 is NOT gated on isEdit) are written on BOTH create and edit, and hr.js:3798 multiplies foodAllowance by days-worked straight into the payslip — so the approval-routed Raise flow fences only two of six pay-bearing fields. (2) 'Real pesos out' is overstated: the Submit → General Ledger step is blocked twice for secretary — openPayslipHistory's `const canAct = ['president','owner','manager','finance'].includes(currentRole)` (hr.js:3318) never renders ps-advance-btn, and the handler's window.BankAccounts.list() would die on rules:1610 canFinance() before Ledger.upsertByRef (rules:1464). The finding's trailing 'On EDIT, allowances…' clause about payslip edit is also UI-unreachable (same canAct gate plus _payslipCanEdit at hr.js:4701), though rules would still permit those writes to a non-UI caller. True consequence: a secretary can set a Production worker's rates at creation, raise an existing worker's food/meal/transport allowances and rewrite their cash-advance balance on edit, and persist an official numbered worker-visible weekly payslip (hr.js:4161 payslips.add; hr.js:4460 official:true, docNumber PS-W-*; surfaced by js/screens/worker.js:1164 regardless of status) — no President approval, no rules-layer stop. The delete legs ARE correctly President-only (rules:1633/1641), which is exactly the intent the create/update legs miss. High, not critical: the money never reaches the ledger or a disbursement, and the actor is an already-trusted oversight insider.

**Fix**

Two layers; the rules edit is the actual boundary fix. (1) firestore.rules — in `match /payslips/{docId}` (line 1632) and `match /worker_profiles/{docId}` (line 1640) change `allow create, update: if isAuth() && isFinanceOrAdmin();` to `allow create, update: if isAuth() && isMoneyAdmin();`, leaving both `allow read` at isFinanceOrAdmin() (secretary oversight read is intended) and `allow delete: if isAuth() && isPresident();` unchanged. Do the same for `match /worker_directory/{docId}` (lines 1651-1652, create/update AND delete → isMoneyAdmin()), since that mirror is maintained by the same HR profile save and would otherwise let secretary rewrite the roster projection. Add a comment mirroring the bank_accounts precedent at rules:1606-1608. Deploy with `firebase deploy --only firestore:rules` (CLI at ~/.npm-global/bin/firebase; git push does NOT ship rules), and re-run `git diff firestore.rules` immediately before deploying per the concurrent-session hazard. (2) UI defense in depth — do NOT narrow `isFinancePriv()` at js/departments.js:27; it has 13 call sites (bir.js:468/1229, ui-crud-table.js:57, finance.js:948/1246/1993/2120, production.js:2364, hr.js:865/3180) and a global change would strip secretary from unrelated oversight screens. Instead add beside it `function isMoneyPriv() { const r = window.currentRole || ''; return ['president','owner','manager','finance'].includes(r) || (r !== 'secretary' && (window.currentDepts||[]).includes('Finance')); }` plus `window.isMoneyPriv = isMoneyPriv;` (mirror of rules' isMoneyAdmin() || isFinanceDept()). Then in js/screens/hr.js: set line 2555 to `const isPriv = isMoneyPriv();`; wrap the ungated per-row Payslip button at hr.js:2603 in `${isPriv? … :''}` and its listener at hr.js:2679-2681; and add an early guard `if (!isMoneyPriv()) { Notifs.showToast('Pay changes are President/Manager/Finance only.','error'); return; }` at the top of the profile-save handler (the block ending at hr.js:3039 `db.collection('worker_profiles').doc(profileId).set(data,{merge:true})`) and at the top of the payslip Save & Generate handler (hr.js:4150-4161), so a stale DOM cannot drive the write. Do not hand-edit APP_VERSION/CACHE_VER — the pre-commit hook bumps them. Smoke-test as secretary afterwards: HR → Payroll → Type B should still list workers and open payslip history read-only, with no + Add Worker Profile, no Raise/Edit/Delete/Sync Directory, and no per-row Payslip button.

---

## MEDIUM (33)

### F03 — Memo → General-feed mirror post is denied by the posts create allowlist on every memo, and the failure is swallowed by a bare catch — the feed memo card and its delete-cleanup are 100% dead code

**What is true**

CONFIRMED at the code level, verbatim, in the current working tree (git diff HEAD is empty for firestore.rules, dashboards.js and people.js — the finding's line numbers are in fact exact; the "~36-line drift" both the code and reach refuters reported does not exist in the tree I read).

Mechanism: firestore.rules:254 is the ONLY /posts/{postId} match block (grep "match /" shows just it plus notifications and the two `coll.matches('files_.*')` / `coll.matches('budgets_.*')` wildcards, neither of which matches `posts`), and its create rule at :269-276 uses a strict `request.resource.data.keys().hasOnly(['title','content','dept','status','authorId','authorName','authorPhoto','pinned','imageUrl','fileName','fileUrl','createdAt'])`. The memo mirror write at js/screens/dashboards.js:4062-4075 sends three keys absent from that list — `kind:'memo'` (4065), `memoId: memoRef.id` (4066), `hearts: []` (4073) — so hasOnly() is false and the create is denied for every caller including the President. A second, independent denial stacks for non-president publishers: the payload hardcodes `status:'published'` (4064) while :274-276 forces `== 'pending'` unless isPresident(). `} catch(_) {}` at dashboards.js:4076 swallows it; Notifs.success('Memo published — N tagged for conforme.') fires two lines later, and js/errlog.js's only hooks are window.onerror / onunhandledrejection, neither of which a caught rejection reaches. No Cloud Function writes the mirror (grep memo/posts over functions/index.js: zero hits). Consequences that are genuinely dead: the entire `if (p.kind === 'memo' && p.memoId)` mirror-card branch at js/screens/people.js:151-172 (reachable feed — people.js:129 queries dept=='General' && status=='published' for all internal staff) can never render, and deleteMemo's cleanup `where('memoId','==',memoId)` at dashboards.js:4219 always matches zero docs.

I FOLLOW the effect lens's correction and DOWNGRADE from the finding's claimed high/compliance impact. The finding's consequence sentence "the acknowledgment trail is thinner than management believes" is false and I am striking it: conforme state lives on memos/{id}.conformes; the `Notifs.send(... type:'memo')` fan-out to tagged recipients sits OUTSIDE the swallowed try (dashboards.js:4078-4082) so every tagged staffer is still notified; notifications.js deep-links type 'memo' to the Memos route; and memos remain fully listed and conforme-able at Company → Memos (dashboards.js:3614) and the standalone `memos` route (renderMemosPage, dashboards.js:4227-4231). What is actually lost is passive discovery in the Posts feed for untagged staff, plus a permanently dead designed feature and its delete-cleanup, failing silently behind a success toast. I also REJECT the finding's LENS label: this is not a rules-security defect — the rule is correctly restrictive and nothing is over-permitted; it is a client-payload/rules contract mismatch, i.e. a correctness bug. No peso amount, ledger entry, or access-control boundary is touched. One caveat neither refuter could close and I cannot either: firestore.rules deploys separately from app code (`firebase deploy --only firestore:rules`), so this judgement is against the committed ruleset; confirm the live ruleset before sizing.

**Fix**

Two edits plus a rules deploy.

1) firestore.rules — widen the `match /posts/{postId}` create rule (lines 269-276) to admit the memo-mirror shape WITHOUT weakening decision D10 (only the president publishes ordinary posts directly). Add 'kind','memoId','hearts' to the hasOnly() list and branch on kind:

allow create: if isAuth() && !isPartner() &&
  request.resource.data.get('authorId','') == request.auth.uid &&
  request.resource.data.keys().hasOnly([
    'title','content','dept','status','authorId','authorName','authorPhoto',
    'pinned','imageUrl','fileName','fileUrl','createdAt','kind','memoId','hearts'
  ]) &&
  request.resource.data.get('hearts', []) == [] &&
  ( request.resource.data.get('kind','') == 'memo'
      ? ( isAdmin()
          && request.resource.data.get('memoId','') is string
          && request.resource.data.get('memoId','') != ''
          && request.resource.data.get('dept','') == 'General'
          && request.resource.data.get('status','') == 'published' )
      : ( request.resource.data.get('kind','') == ''
          && request.resource.data.get('memoId','') == ''
          && (isPresident()
              ? request.resource.data.get('status','') in ['published','pending']
              : request.resource.data.get('status','') == 'pending') ) );

Rationale for each clause: `hearts == []` stops a seeded like-list (the existing update rule at :287 already scopes heart toggles to the caller's own uid, so hearts is a legitimate field that was simply never allowlisted for create); the isAdmin() gate on kind=='memo' mirrors firestore.rules:1167-1169 where `memos` create is already isAdmin()-only, so only accounts that can publish a memo can publish its mirror; the else-branch pins ordinary posts to the old behaviour and additionally forbids a non-memo post from smuggling kind/memoId. Then run `~/.npm-global/bin/firebase deploy --only firestore:rules` — a git push does NOT ship rules.

2) js/screens/dashboards.js:4076 — stop swallowing. Replace `} catch(_) {}` in the memo-publish handler with a visible, non-fatal warning so a future rules regression cannot hide again:

} catch (e) {
  console.warn('[memo] feed mirror failed:', e);
  Notifs.showToast('Memo published, but it could not be added to the General feed.', 'error');
}

Keep it non-fatal (outside the outer try's failure path) so the memo + conforme notifications still complete.

3) Verify after deploy: publish a memo as president AND as a manager, confirm a posts doc with kind:'memo' exists and the mirror card renders via js/screens/people.js:151, then delete the memo and confirm dashboards.js:4219's cleanup now removes it. Note firestore.indexes.json needs no change — `where('memoId','==',...)` is a single-field equality, auto-indexed.

4) Per CLAUDE.md, the pre-commit hook bumps APP_VERSION/CACHE_VER for the dashboards.js edit; do not hand-edit them.

### F04 — Quote builder swallows the product_costs permission-denial and renders the Cost & Margin panel as ₱0 COGS / 100% margin for Sales roles (and for the BS partner) — display/decision-support defect, latent until the cost migration runs

**What is true**

The mechanism is real and I confirmed every cited line myself. firestore.rules:1148-1150 restricts product_costs to `isAuth() && !isPartner() && (isAdmin() || canFinance())`; role 'agent' and a Sales-dept employee are in neither helper set (rules:21, :31, :43). quote-builder-v2.html:1639-1647 issues the product_costs read for ANY non-PARTNER_MODE session and swallows the denial in a bare `console.warn`, leaving `costMap = {}`; :1664-1665 then falls back `(c && c.capitalMaterials) ?? p.capitalMaterials ?? 0`. The panel is not role-gated — applyPartnerMode (:1789-1791) removes `#btnInternal`/`#costMarginWrap` only for GENERIC_PARTNER — and js/app.js:1791-1793 only sets `?portal=partner` for partners, so an internal Sales session reaches it. Reach is confirmed end-to-end (config.js deptLoop → renderSales → sales.js "＋ New Quotation" → app.js `case 'bk-quote-builder'`, no role gate anywhere), one click on 🔒 Internal.

But two of the finding's three claims do not survive.

(1) The EFFECT lens is decisive and I verified it independently: the zeroed fields feed nothing that produces a peso figure. computeTotals() (quote-builder-v2.html:3001-3037) derives subtotal → volume break → D&I → discount → net → VAT → grand → commission entirely from item amounts, VOLUME_TIERS and operator-typed discount/commission inputs — it never reads capitalMaterials/capitalLabor. buildQuotePayload() (:4444+) persists no cogs/margin key at all. computeMarginSummary (:3508-3540) only assigns textContent and a colour and returns nothing any caller uses (:3064, :3502). Repo-wide, the only other consumers are sales.js:249/399 (copied onto a Quick-Estimate item, never read — sales.js:460-470 renders Subtotal/VAT/Total only) and dashboards.js's Product Database display. dashboards.js:4705 grossMargin is job-cost based, unrelated. So the client-facing and stored money on a ₱500k quote is byte-identical either way; the mechanical delta is ₱0.00. This is a decision-support/display defect, not a money defect — money=false.

(2) The security half ("or the external partner can read the company's entire cost basis") is refuted by the rules I read: :1148-1150 explicitly excludes isPartner(), and /products create/update now reject docs carrying capitalMaterials/capitalLabor/bom (productCostFieldsLocked, rules:1114-1136). The rules boundary is intact — this is the client mishandling a legitimate denial, not a rules gap. security=false.

(3) The CODE lens's timing correction is right and I confirmed it: js/migrations.js:446-453 says outright "no dedicated button exists yet … run this from the browser console: await window.runProductCostsMigration()". Until a president runs that, the legacy fields are still on every products doc (read: isAuth), so `?? p.capitalMaterials` resolves to the REAL cost for a Sales session and the panel is currently correct. The defect is latent — it arms itself the instant the intended rollout migration runs.

What genuinely stands: a silent, role-dependent degradation with no UI signal. Post-migration a Sales agent sees Materials ₱0, Cap-Labor ₱0, COGS = labor-estimate only, Gross Margin = ~100% of net, with nothing on screen saying "you can't see costs" — and they are exactly the people typing the discount field. It also propagates: buildQuotePayload persists `items` with capitalMaterials:0 and loadEditableState restores them verbatim without re-deriving, so a finance/manager reviewer reopening an agent-filed quote sees the same zeros despite having read access. Two things the finding missed: the Quick Estimate handoff (sales.js:475-486 `_qbReopenState.items`) injects zeroed costs into the builder basket for EVERY role including finance, and quote-builder-v2.html:1782-1791 explicitly documents that the Brilliant Steel partner "keeps the per-item Cost & Margin view for the 50/50 split" — which the new rule makes permanently ₱0, an unresolved design contradiction. Mitigating: the failure is visually loud (every per-item row renders ₱0/₱0 at :3520), not subtly optimistic. Hence medium, not high.

**Fix**

Four edits, none touching firestore.rules (the rule is correct as written).

1. quote-builder-v2.html — stop swallowing the denial. In loadDatabase() at ~1639-1647, set a module-level flag in the catch instead of only warning:
   `let costMap = {}; window.COSTS_DENIED = false;`
   `catch (ce) { if ((ce.code||'') === 'permission-denied') COSTS_DENIED = true; console.warn(...); }`
   Declare `let COSTS_DENIED=false;` alongside the other top-level lets (~1575-1590).

2. quote-builder-v2.html — role-gate the panel instead of showing fabricated zeros. In applyPartnerMode()'s sibling path (add a new `applyCostVisibility()` called from the same DOMContentLoaded/initUI point as applyPartnerMode, ~1797): `if (COSTS_DENIED) { document.getElementById('btnInternal')?.remove(); document.getElementById('costMarginWrap')?.remove(); if (currentView==='internal') setView('client'); }`. Removing the DOM nodes (not display:none) matches the existing GENERIC_PARTNER treatment at :1789-1791. Belt-and-braces in computeMarginSummary() (:3508): early-return after writing a single "Cost basis unavailable for your role" line into #miCogs/#miMargin rather than formatting ₱0 — so it can never render a 100% margin off missing data.

3. js/screens/sales.js — the Quick Estimate feeds zeros to everyone. In qeLoadDB() (~236-258) and qeAddItem() (~399-400), either (a) `await window.loadProductCostsCache()` first and merge `window._productCostsCache[d.id]` the way js/app.js:2196-2208 normalizeProduct() does, or (b) simplest and safest — DROP `capitalMaterials`/`capitalLabor` from the `_qeDB.products` map and the `_qeItems.push` payload entirely, so the handoff at :475-486 doesn't inject 0 into `_qbReopenState.items` and the builder resolves cost from its own product_costs load. Prefer (b) unless the Quick Estimate is ever going to show margin.

4. quote-builder-v2.html — resolve the Brilliant Steel contradiction (:1782-1791). Either delete the BS cost/margin exception and its comment (BS loses the panel like GENERIC_PARTNER, since PARTNER_MODE skips the read at :1640 and the rule denies them anyway), or add an explicit `isBrilliantPartner()` allowance to the product_costs rule and let PARTNER_MODE attempt the read for that one role. Do not leave a panel on screen that the data layer guarantees will read ₱0.

Optional but related: js/migrations.js:446-453 — wire the president-only migration to a real button on the Product Database screen (js/screens/dashboards.js), and do NOT run it until edits 1-3 ship, since running it is what arms this defect. Note separately that dashboards.js:631-666 still writes capitalMaterials/capitalLabor/bom into the products doc, which firestore.rules:1129-1136 now rejects on create — that is a distinct breakage, out of F04's scope.

### F05 — it_tickets update rule (creator || isAdmin) is narrower than the UI's canEditDept('IT') gate — non-admin IT-dept staff get a dead "Update Ticket" button with no error

**What is true**

Confirmed by direct read of all four decisive locations, with the finding's scope and lens corrected.

What is actually true: firestore.rules:1286-1289 gates it_tickets update on `resource.data.createdBy == request.auth.uid || isAdmin()`, and isAdmin() (firestore.rules:21) is president/manager/secretary only. The UI gates the Status / Assigned To / Resolution Notes fields and the Update Ticket button on `canEdit = canEditDept('IT')` (js/screens/govit.js:175, passed to openITTicketModal at :315, consumed at :805-820), and canEditDept (js/departments.js:17-25) returns true for ANY role whose currentDepts includes 'IT'. So a plain employee/agent in the IT department is shown a fully-editable ticket modal for a ticket someone else filed, and the write is denied server-side. The click handler at govit.js:821-830 has no try/catch and no .catch(); the rejection aborts before closeModal()/onRefresh(), and the only global handler (js/errlog.js:102-109) writes to the error_log collection and shows no toast — so the button is genuinely dead with zero feedback. The repo's own onClickSafe wrapper (js/departments.js:31-39), which exists precisely to toast these failures and is used throughout hr.js and approvals.js, is not used here. The mismatch is unique to it_tickets: it_assets/it_software (rules:1293-1300) use canDept('IT') and it_access/it_network (1301-1308) use isAdmin()||inDept('IT'), all of which match the UI gate. createdBy IS written on create (govit.js:343), and govit.js:822 is the only it_tickets update in the tree, so nothing repairs a stuck ticket.

Corrections to the finding (all three refuters flagged the same overstatement, and I agree):
- NOT a security defect. The rules are STRICTER than the UI — this fails closed. There is no privilege escalation or data exposure, so the 'rules-security' lens label is wrong and security=false.
- Scope is narrower than "the IT ticket queue is write-once". President, manager and secretary can update any ticket, and any user can update a ticket they themselves created. A 'finance'-role user in IT is also unaffected — canEditDept returns dept==='Finance' for that role, so they correctly get the read-only view. The broken population is exactly: non-admin, non-finance roles (employee/agent) in the IT department acting on a ticket filed by someone else — which is the queue's primary intended use.
- The blocked write covers assignedTo and resolutionNotes as well as status, so those staff can neither assign nor annotate.
- Line drift only: the canEdit block is govit.js:805-818 (button on 819), the handler 821-830, canEditDept js/departments.js:17-25.
- Severity lowered from high to medium: no money moves, no data is exposed, and an admin workaround exists — but a shipped department workflow is unusable for its intended operators with no error message, and the fix is trivial.

Reachability confirmed independently: js/app.js:1375-1376 builds the `dept:IT` sidebar item for anyone with IT in their depts, js/app.js:2369 dispatches `dept:` with no page-access check, js/app.js:2838 calls window.renderIT, and govit.js:180-182 includes 'IT Tickets' in the non-admin subtab list.

**Fix**

Two edits, both small.

1. firestore.rules — widen the it_tickets update rule to match the UI gate and the sibling IT collections. In the `match /it_tickets/{docId}` block (around line 1284-1291), change:

    allow update: if isAuth() && (
      resource.data.createdBy == request.auth.uid || isAdmin()
    );

to:

    allow update: if isAuth() && (
      resource.data.createdBy == request.auth.uid || canDept('IT')
    );

canDept(d) (firestore.rules:76) already resolves to isAdmin() || inDept(d), so this preserves the existing admin path and adds IT-department members — exactly what it_assets/it_software already do. Keep `allow delete: if isAuth() && isAdmin();` as is. Then deploy the rules separately from the app: `~/.npm-global/bin/firebase deploy --only firestore:rules` (git push does NOT ship rules). Per the repo's re-diff memory, run `git diff firestore.rules` immediately before deploying so a concurrent session's uncommitted rule edits are not shipped with it.

2. js/screens/govit.js — wrap the update handler in the existing onClickSafe so any future permission-denied surfaces as a toast instead of a dead button. Replace lines 821-830:

    document.getElementById('upd-ticket-btn')?.addEventListener('click', async () => {
      await db.collection('it_tickets').doc(ticket.id).update({ ... });
      closeModal(); onRefresh?.();
    });

with:

    const updBtn = document.getElementById('upd-ticket-btn');
    if (updBtn) onClickSafe(updBtn, async () => {
      await db.collection('it_tickets').doc(ticket.id).update({ ...unchanged payload... });
      closeModal(); onRefresh?.();
    });

onClickSafe is a bare top-level function declaration in js/departments.js:31, which resolves as a global across classic <script> files (already called this way from js/screens/hr.js:3407 and js/screens/approvals.js:457), so no import or window. prefix is needed.

Optional same-pass hardening: the ticket-create handler at govit.js:335-346 is likewise unwrapped; it currently works because create is `allow create: if isAuth()`, but wrapping it in onClickSafe removes the same silent-failure class.

Do not hand-edit APP_VERSION or CACHE_VER — the pre-commit hook bumps both.

### F08 — errlog.js gates every write on window.db, which is never assigned — the uncaught-error channel has never written a document, and System Health renders the empty error_log as a green "no errors" state

**What is true**

STANDS, with the mechanism corrected and the blast radius narrowed. Verified myself: js/firebase-config.js:23-25 declares `const auth/db/storage` at the top level of a CLASSIC deferred script (index.html:404, no type="module"), so the bindings live in the global declarative record and never become properties of window. A repo-wide grep finds zero `window.db =` assignments in the shipped tree (only dev/_sop_preview.html:18 and .claude/worktrees/* copies). js/errlog.js is the only file that reads `db` via `window.db` — five sites (:45, :46, :57, :78, :127) — so writeToFirestore always returns false, tryFlushBuffer always returns early, record() always buffers, and the 500ms poller (:125-133) hits its ~20s cap, clears itself and never rearms. js/errlog.js:46 is the sole writer to error_log, so the collection can only ever be empty. This is not masked by rules: firestore.rules:1757-1771 explicitly allows the create with exactly buildPayload's field set (the in-file comment even names js/errlog.js buildPayload as the producer). And the emptiness is affirmatively misreported to the owner: js/screens/dashboards.js:132 queries error_log with BARE `db` (which resolves fine — the split is real) and :205 renders renderEmptyState({icon:'✅', title:'No errors logged', hint:'error_log has been clean for the last 7 days.'}), on a page routed at js/app.js:2425 and nav-pinned for president and finance (js/config.js:509, :553). All three lenses agreed and all three raised the same two corrections, which I confirmed and am adopting: (1) the finder misnames the drop mechanism — `writeCount` only increments when `ok` is true (js/errlog.js:63, :88) and `ok` is permanently false, so the `writeCount >= MAX_WRITES` guard at :72 NEVER fires; distinct errors 6+ are dropped by BUFFER_CAP at :80 and repeats by the seenHashes session dedup at :75. Same net result (zero rows), different guard. (2) the finder's blast radius is too wide — record() is only reachable from window.onerror (:94) and window.onunhandledrejection (:102), and window.logClientError (:112) has ZERO call sites anywhere in js/ (grep returns exactly one hit, its own definition). So try/catch-swallowed failures like the stuck 'Approving…' buttons or null-container writes would NOT have landed in error_log even with window.db wired; only genuinely uncaught exceptions and unhandled rejections would, capped at 5 per session. Severity is medium, not high: nothing about money, access control or user data is affected — this is a dead telemetry channel plus a monitoring surface that reports the void as healthy. It is permanent and self-perpetuating (no retry after the 20s poller expires) and the President/finance false-green makes it worse than merely silent.

**Fix**

Two edits, both small.

1) Expose the globals as window properties (root cause). In js/firebase-config.js, immediately after the `const auth/db/storage` block at lines 23-25, add:

    // Top-level `const` in a classic script creates a global LEXICAL binding, not a
    // window property. js/errlog.js reads `window.db` (it must not assume load order),
    // so publish the references explicitly.
    window.auth = auth;
    window.db = db;
    window.storage = storage;

This is the minimal fix and matches the codebase's existing pattern (js/app.js:2343 does the same for the lexical `let currentPage` at js/app.js:11). It is inert for every other file, since all of them already resolve the bare lexical `db`. Alternatively, change the five reads in js/errlog.js (:45, :46, :57, :78, :127) to a local `function fsdb(){ try { return (typeof db !== 'undefined' && db) || window.db || null; } catch(_) { return null; } }` — but the firebase-config assignment is preferable because it also fixes any future window.db reader.

2) Make the failure non-silent instead of self-congratulatory. In js/screens/dashboards.js renderSystemHealth (empty branch at :205), stop asserting health from an empty query. Either (a) have errlog.js write/refresh a heartbeat doc (e.g. system_health/errlog_client with a lastSeen serverTimestamp) on boot and have the empty state read "No errors logged — client logger last reported <time>" vs "No errors logged AND no telemetry heartbeat in 7 days — client logging may be broken", or (b) at minimum soften the hint to "No error documents in the last 7 days (client logging captures only uncaught errors/rejections, max 5 per session)" so an empty table is not read as a verified-clean signal.

Optional follow-ups, not required to close this finding: add window.logClientError(err, 'context') calls at the swallowing catch blocks that matter (task create, approvals) since the manual hook currently has no callers, and note that js/errlog.js:33 `page: window.currentPage || 'boot'` will read 'boot' until the first navigateTo runs, which is correct but worth knowing when reading the restored logs.

Bump/verify per repo rules: the pre-commit hook auto-bumps window.APP_VERSION in js/config.js and derives CACHE_VER in sw.js, so no hand-edit of the version. Verify by serving locally (npx serve -p 3838 .), evaluating `typeof window.db` (must be 'object'), then triggering a synthetic unhandled rejection and confirming an error_log document appears.

### F09 — openConversation wires its three thread listeners after an unguarded await — closing or switching threads mid-open leaks listeners and can paint conversation A's messages into conversation B's open window

**What is true**

The mechanism is exactly as described and I confirmed every cited line. js/chat.js:1733 awaits _myReadAtForOpen, and nothing between that await and the three _threadUnsubs.push(...onSnapshot...) calls (js/chat.js:1757 messages, :1788 readers, :1791 typing) or the setInterval at :1795 re-checks liveness. teardownThread (js/chat.js:250-251) rebinds _threadUnsubs to a fresh array and nulls _openConvId, so a teardown during the await unsubscribes nothing and the resumed continuation subscribes into whatever array is now live. _renderThread (js/chat.js:4923-4953) resolves its target purely by the fixed id chat-thread-scroll and has no conversation identity check, so a stale listener's snapshot takes the el.innerHTML = _threadHtml(list) full-replace branch (a foreign conv's ids never satisfy the prefix canPatch test at :4938) and repaints whichever thread is mounted. All three lenses voted STANDS and I agree with the mechanism, but the finding's severity framing is overstated in two ways and understated in one.

Overstated (1): the trigger is narrower than "the first time any user opens any conversation". _myReadAtForOpen's fast path (js/chat.js:1690-1691) returns inside an async fn, i.e. on a microtask, which no user click can interleave with — so the window genuinely requires the network branch (conv.reads[uid] absent: never-read or legacy convs). Overstated (2): the harmful mispaint variant is not universal. On phone, _syncMainInert (js/app.js:3644-3660) marks #main-content inert the moment the thread page is on the cover stack, so the inbox rows that call openConversation (js/chat.js:748) are unclickable during the await; the switch-threads race needs the >=1024px two-pane layout (css/styles.css:4382-4399, inbox column stays visible beside #chat-thread-panel) or the notification deep-link at js/notifications.js:147. The Back-out variant is reachable everywhere but is genuinely inert — _renderThread returns at :4926, _markRead returns at :1800, _renderTypingRow returns at :2188, no stray writes — and the leaked subs die at the next teardown, so "survive until reload" is wrong and the Firestore billing (~50 reads on subscribe, PAGE_SIZE at js/chat.js:10, well under PHP 1 per incident) is immaterial and should not carry the rating. I follow the effect lens in dropping the "one client's thread rendering inside another's" framing: both listeners belong to the same signed-in user, who is a participant in both conversations under firestore.rules:656/711/716 and could open either anyway — no president/manager/partner sees anything they were not already entitled to.

Understated: no lens traced the write path. _armReply (js/chat.js:3861) stores { mid, author, snippet: snippetSrc.slice(0,80) } and sendMessage writes msgDoc.replyTo = { mid, author, snippet } (js/chat.js:2001) into conv = convParam || _openConv (js/chat.js:1939), which is thread B. So a user who swipe-replies to a conversation-A message mispainted into B's window publishes 80 verbatim characters of A plus A's author name into B, readable by B's participants. That is a real cross-conversation content leak, but it is a four-way conjunction (never-read conv + desktop two-pane + a click landing inside the get() round-trip + A's snapshot resolving after B's + the user not noticing) so it is the worst case, not the expected case, and it does not make this an access-control defect. Also confirmed and unreported: js/chat.js:1795 assigns _typingExpireTimer without clearing the previous handle, so in the switch variant the first interval is orphaned permanently (teardown at js/chat.js:280 only clears the current one) — harmless per tick but an unbounded timer leak. Net: a real, reachable async race with a narrow window, no money and no privilege impact, whose observable harm is a wrong-conversation repaint plus a compound misdirected-reply risk. Medium, not high.

**Fix**

All edits in js/chat.js. Bump nothing by hand — the pre-commit hook handles APP_VERSION/CACHE_VER.

1. Add an open-generation token (the exact fix; a bare `_openConvId !== convId` test is nearly right but mis-handles reopening the SAME conv while a previous open is in flight).
   - At js/chat.js:38, beside `let _openConvId = null, _openConv = null;`, add `let _openSeq = 0;`.
   - In `teardownThread` (js/chat.js:250-251), next to `_threadUnsubs = []; _openConvId = null; _openConv = null;`, add `_openSeq++;` so any close invalidates in-flight opens.
   - In `openConversation`, right after `_buildThreadPanel(conv); _openConvId = convId; _openConv = conv;` (js/chat.js:1713-1714) capture `const mySeq = _openSeq;` (teardownThread already ran at :1704, so this reads the post-bump value).
   - Immediately after `_threadOpenReadAtMs = await _myReadAtForOpen(convId, conv);` (js/chat.js:1733) insert `if (_openSeq !== mySeq) return;   // thread closed or switched while the readers get() was in flight`. This is the single load-bearing edit: it prevents the three subscribes, the setInterval, and the state clobber of `_threadInitialScrollDone`/`_pending`/`_replyTarget`/`_initialMarkReadPending` at :1734-1739 from ever running for a dead open.

2. Belt-and-braces at the sinks, so any future stale listener cannot repaint. At the top of each of the three onSnapshot callbacks — js/chat.js:1759 (messages, before `_msgs = s.docs.map(...)`), :1788 (readers, before `_readers = ...`), :1791 (typing, before `_typing = ...`) — add `if (_openConvId !== convId) return;`. Note the existing `_openConvId === convId` test at :1775 is one statement too late: it wraps only `_markRead(); _clearChatNotifs(convId);`, after `_renderThread()` at :1762 has already painted.

3. Fix the orphaned interval: at js/chat.js:1795 change `_typingExpireTimer = setInterval(_renderTypingRow, 2000);` to clear first — `if (_typingExpireTimer) clearInterval(_typingExpireTimer); _typingExpireTimer = setInterval(_renderTypingRow, 2000);` — mirroring the guarded clear already in teardownThread at :280.

4. Optional hardening, same class, one line: `_renderThread` (js/chat.js:4923) is the shared paint sink with no identity check. Give it an optional expected-conv argument or an early `if (!_openConvId) return;` after the `if (!el) return;` at :4926, so a paint can never happen with no thread nominally open.

Verify by serving locally (`npx serve -p 3838 .`), opening a conversation the signed-in uid has never read (so `conv.reads[uid]` is absent and js/chat.js:1693's get() is on the wire), and (a) pressing Back within the round-trip — confirm no `conversations/{A}/messages` listener remains in the Firestore debug log; and (b) at >=1024px, clicking inbox row B during A's round-trip — confirm B's messages stay painted and the header/composer/_openConvId all agree.

### F10 — navigateTo fire-and-forgets async render* calls with no generation token, so a slow abandoned screen repaints over the page the user actually navigated to (nav highlight / hash / history then disagree with what is on screen)

**What is true**

The structural defect is real and I confirmed every load-bearing claim directly. js/app.js:2320 `navigateTo(page, opts)` is synchronous: it pushes history (2337-2339), sets `currentPage`/`window.currentPage`/`window.currentSubtab` and `setActiveNav(page)` (2342-2345), grabs `const c = document.getElementById('page-content')` (2358), wipes it with `c.innerHTML = window.skeletonHtml(...)` (2366), then dispatches bare un-awaited calls from the switch (2377-2431, e.g. `case 'projects-lifecycle': window.renderProjectLifecycle?.(); break;`). There is no in-flight lock, no cancel, no generation stamp. index.html:301 `<div id="page-content"></div>` is the single container and `grep replaceWith|replaceChild|outerHTML js/app.js` returns zero hits, so the node is never replaced — a `c` captured by an earlier render survives the navigation and its post-await `c.innerHTML = ...` lands on the new page. I confirmed the capture-before-await-then-blind-repaint shape in js/screens/dashboards.js:931-932 → `await Promise.all([~20 reads])` at 937 → repaint at 1048 (renderPresidentDashboard), dashboards.js:1571 → 1666 (renderEmployeeDashboard, the default landing screen for every employee), js/screens/production.js:486 → awaits at 497/511 → repaint at 537 (renderProjectLifecycle), and js/screens/people.js:1596-1602 (renderCashAdvancePage). Guard grep confirms the finding: the only liveness check anywhere is js/screens/tasks.js:548 `function pageStillLive(panel)`, which takes an Overlay panel and is used only at tasks.js:596/1024/1153/1321 — never for a page render. Nav taps are unguarded and not disabled during load (js/app.js:1539 bottom nav, 1437 sidebar, 4091 popstate). Nothing self-corrects: no `onSnapshot` repaints `#page-content`, so the wrong screen persists until the user navigates again. All three lenses converged and I reached the same conclusion independently, so I follow none of them as a refutation — but I do adopt two of their corrections, which the finding got wrong. (1) "Every control on that phantom screen operates on the wrong record set" is FALSE: the stale DOM and its handlers are the abandoned page's own, bound to its own data, so its buttons act correctly on what the user is looking at. I checked the one plausible contamination channel — `grep "window.currentSubtab|window.currentPage" js/screens/*.js` returns nothing, and subtab is consumed synchronously as a default parameter (`window.initialSubtab`, js/config.js:1888) before any await. No cross-page data mixing, no misdirected write, and both renders belong to the same authenticated user, so there is no privilege or data-exposure angle. (2) "Back exits to the page BEFORE the one they think they are on" is backwards: history for the destination is pushed synchronously at 2337-2339, so with stack A→B→C showing B's content, Back pops to C→B and re-renders B, reading as a no-op and needing two presses to reach A. Also cosmetic: the finding says "13 screens" while listing 12; dashboards.js:4488 is a blank line (the real neighbours are renderDepartments at 4456 and renderAnalytics at 4525); and production.js:501 is the catch-block repaint, the unguarded success repaint is at 537. Two narrowings that keep it real but not high: the abandoned render must resolve LAST (true for the heavy screens named, which is the realistic direction), and `dbCachedGet(..., 30000)` shrinks the window on repeat visits within 30s — but the first visit per cache window is exactly the "tap heavy tab, give up, tap elsewhere" case. Net: a genuine, systemic, persistent wrong-screen/identity-desync defect across every role on slow mobile links — high-visibility UX correctness, but no money, no security, no data corruption, hence medium rather than high.

**Fix**

Add a nav-generation token at the chokepoint and a one-line guard in each post-await repaint. (1) js/app.js, in `navigateTo` (~2342, right where `currentPage = page` is set): `const gen = (window._navGen = (window._navGen || 0) + 1);` and expose a helper next to it, e.g. `window.navGen = () => window._navGen || 0; window.navStillCurrent = g => g === (window._navGen || 0);`. Bump it for the `dept:` early-return path too (it returns at ~2436 before the switch). (2) In each async page render, capture the token beside the container and re-check after every await before painting: `const c = document.getElementById('page-content'); const gen = window.navGen();` then immediately before each `c.innerHTML = ...` that follows an await, `if (!window.navStillCurrent(gen)) return;`. Apply to js/screens/dashboards.js renderPresidentDashboard (932 capture, guard before 1048), renderEmployeeDashboard (1572 → guard before 1666), and the sibling role dashboards at 120, 231, 1177, 1317, 1420, 1956, 3395, 4456, 4525; js/screens/production.js renderProjectLifecycle (486 capture, guard before the success repaint at 537 AND before the catch repaint at 501 — a stale error banner is the same bug); js/screens/people.js renderCashAdvancePage (1596 capture, guard before the `await renderCashAdvanceAdmin(c)` / `renderCashAdvanceEmployee(c)` calls at 1602-1604 and in the catch repaint); js/screens/worker.js renderWorkerHome (1234). Guard the async error/catch branches as well as the success branches. Cheaper alternative that fixes all screens with no per-screen edits: in `navigateTo`, swap the container instead of wiping it — after the existing Chart.js destroy loop, `const fresh = c.cloneNode(false); c.replaceWith(fresh);` — so late writes land on a detached node and are invisible. If you take that route you MUST re-attach the KPI font-fit observer at js/app.js:4343 (`new MutationObserver(run).observe(pc, ...)` binds to the specific element and would silently stop firing after the first swap), and re-point the local `c` used by the switch's inline `default:`/access-denied branches at the fresh node. Either way, also consider disabling/showing a pending state on nav buttons (js/app.js:1539) while a render is in flight, though the token alone is sufficient for correctness. No firestore.rules or index changes needed; bump only what the pre-commit hook handles.

### F12 — Toast offset branch is inverted: on phones (≤640px) the pill lands inside the bottom-nav row and swallows nav taps for 3.5s

**What is true**

CONFIRMED by my own reading, with two scope corrections. js/notifications.js:1087-1091 branches on `matchMedia('(max-width: 640px)')` under the comment "Mobile (no bottom-nav) gets a smaller offset; desktop reserves bottom-nav space" — that premise is backwards. css/styles.css:6381-6382 sets `.bottom-nav { display: none }` in the BASE cascade (I verified the preceding @media at 6329 closes at 6336, so 6381 is unnested), and css/styles.css:3091 inside `@media (max-width: 768px)` (opened at 2814) sets `display: flex !important`. The phone is the tier that HAS the bar. Geometry confirms overlap: the nav is 56px (`--bottom-nav-h`, tokens.css:131) plus safe-area inset with `padding-bottom: env(safe-area-inset-bottom)`, so its tap targets occupy [inset, inset+56]; the toast sits at `bottom: 16px+inset` and is ~38px tall, i.e. [16+inset, 54+inset] — entirely inside the nav row. Hit-testing goes to the toast: z-index `--z-toast: 9990` vs `--z-bottom-nav: 95`, and there is no `pointer-events` declaration anywhere (grep of js/notifications.js and of css/ for `bi-toast` both return zero), so the covered nav buttons are genuinely dead for the toast's 3500ms life (notifications.js:1109). Reach is broad — 217 showToast/Notifs.success/error call sites across js/. No lens refuted it; all three confirmed the code, and I re-derived each cited line rather than taking their word. Two corrections I adopt: (1) SCOPE — the defect is ≤640px only. At 641-768px (styles.css:3091) and 769-819px (styles.css:3187) the bar is also shown, but the toast takes the 84px "desktop" branch, which clears the 56px bar correctly; at ≥820px there is no bar and the 84px is merely wasted. So the branch is wrong for phones, not for every device with a bar. (2) SEVERITY — the finding's IMPACT: high is overstated. The toast removes itself, no state is written, no money or data is touched; the cost is one to three swallowed taps on the primary nav that the user repeats seconds later. It also cannot fire while a page window or the sidebar is open (styles.css:3083-3089 `body.page-open #bottom-nav { visibility: hidden }`, styles.css:1301 `body.sidebar-open .bottom-nav { display: none !important }`) — but the 3.5s lifetime outlives a modal close, so base tab screens still take it. That is a recurring, high-frequency navigation annoyance: medium. One detail the finder undersold rather than oversold: `--toast-bg: var(--surface)` (tokens.css:194) resolves to `rgba(255,255,255,0.05)` in Astral (styles.css:3413), where the pill really is near-invisible while still eating taps.

**Fix**

Two edits, both in `showToast()` in /Users/neilbarro/Library/CloudStorage/OneDrive-Personal/BARRO INDUSTRIES copy/Operation Systems Development/js/notifications.js.

1. Replace the width-guess branch (lines 1087-1091) with a measurement of whether the bar is actually on screen, so the offset can never desync from the CSS again:

    // Reserve bottom-nav space whenever the bar is actually visible (it is
    // shown ≤819px and hidden above, and hidden entirely while a page window
    // or the sidebar is open) — never infer it from viewport width.
    const navEl = document.getElementById('bottom-nav');
    const navCS = navEl ? getComputedStyle(navEl) : null;
    const navVisible = !!navCS && navCS.display !== 'none' && navCS.visibility !== 'hidden';
    const bottom = navVisible
      ? 'calc(16px + var(--bottom-nav-h, 56px) + env(safe-area-inset-bottom,0px))'
      : 'calc(16px + env(safe-area-inset-bottom,0px))';

   Note the nav's own height already adds the safe-area inset via css/styles.css:6386, so `16 + 56 + inset` clears it exactly; do not double-add. Use the `--bottom-nav-h` token rather than the hardcoded 52px so the toast tracks css/tokens.css:131 and the `.nav-shrunk` variant.

2. Add `pointer-events:none;` to the toast's inline `cssText` (line 1092-1100) — belt-and-braces. The pill has no interactive children (only the dot span and the label span, lines 1101-1107) and is dismissed on a timer, so it never needs to receive input; with this set, any future mispositioning degrades to a cosmetic overlap instead of dead nav buttons.

3. Delete/replace the stale comment on line 1087 ("Mobile (no bottom-nav) gets a smaller offset") — it is the reason the bug was written and will re-seed it if left.

Optional hardening in the same pass: js/gestures.js:93 builds another `--z-toast` (9990) fixed element; confirm it carries `pointer-events:none` for the same reason.

No CSS change is required, and no CACHE_VER edit by hand — the `.git/hooks/pre-commit` hook derives `CACHE_VER` from `APP_VERSION`. Verify by loading the app at 390px width, firing `Notifs.success('Task created successfully')` from the console on the dashboard (not inside a page window, which hides the nav), and checking `document.elementFromPoint` at each nav button centre returns the nav item, not `#bi-toast`.

### F14 — Desktop (>768px): the notification dropdown opens behind any open page window — it is trapped in #app-shell's stacking context while openPage windows mount on document.body at z 302 — so the bell reads as dead and its invisible backdrop eats the next topbar/nav click

**What is true**

The mechanism is real and I confirmed it independently. `#notif-panel` and `#notif-backdrop` are children of `#app-shell` (index.html:244 and :256; brace/tag-depth verified inside the `#app-shell` div opened at index.html:201), and `css/styles.css:164` gives `#app-shell { position: relative; z-index: 1; }` — a stacking context. `openPage` appends its `.page-panel` to `document.body` (js/app.js:3809) and `window.Overlay.push('page', teardown, p)` (js/app.js:3971) stamps an inline `z-index: 300 + stack.length*2` (js/config.js:1189) = 302. The panel is opaque and full-bleed below the topbar (`css/styles.css:2307`: `position:fixed; top:calc(var(--topbar-h)+env(safe-area-inset-top,0px)); left:0; right:0; bottom:0; background:var(--bg)`), while `.notif-panel` sits at `top: calc(var(--topbar-h) + … + 8px)` with a static `z-index: var(--z-panel)` = 150 (css/styles.css:962, css/tokens.css:146) and is never registered with Overlay (js/notifications.js:1275-1283 only toggle `.hidden`; the only `Overlay.push` in that file is the push-prompt at :858-860). Because the shell is a stacking context, the root-level window at 302 paints above the panel no matter what its z is — so raising `--z-panel` alone would NOT fix this, which the write-up did not realize. Phones are immune exactly as claimed: `body.page-open #topbar … { visibility: hidden; }` (css/styles.css:3083-3089) and `.notif-panel, .notif-backdrop { display:none !important }` (css/styles.css:3106) are both inside `@media (max-width: 768px)` opened at css/styles.css:2814, and `page-open` is only set when `isPhoneShell()` (js/config.js:1354-1368). Reach is unrestricted: the bell is a static, ungated child of `.topbar-right` wired for every session, and the >768px branch is `openPanel()` (js/notifications.js:1288-1302). The affected band starts at 769px, so tablet-landscape is in scope too. The effect lens did NOT refute the defect — it refuted the write-up's severity, and it is right to. The panel state is sticky (nothing outside notifications.js re-hides it), so it appears on Back; the unread badge stays visible and correct on the exposed topbar; foreground toasts still land above the window at `--z-toast` 9990 on document.body. Notifications are therefore delayed and confusing, not "silently unreachable", so the claimed HIGH impact does not hold. One effect the effect lens under-weighted: `.notif-backdrop` (`position:fixed; inset:0; z-index:140`, css/styles.css:972) is a sibling of `#topbar` (z 100) inside the same shell context, so after the first bell click it covers the one strip of chrome the window leaves exposed — the topbar and the ≥1024px `#top-nav-strip` — and silently swallows the user's next click there (that click just runs `closePanel`). So it is a dead-feeling control plus one eaten nav click, repeating on every one of ~140 openPage surfaces. Note the repo's own dev z-index lint (js/app.js ~3970 comment, `_Z_TOKEN_VALUES`) only scans direct children of body, which is why this shell-trapped panel never tripped it. Medium: real, always-on, user-visible, self-correcting; no money, data, or access-control impact.

**Fix**

Get the notif panel out of `#app-shell`'s stacking context and onto the same Overlay stack as windows — both parts are required; either alone is insufficient (reparenting without Overlay leaves it at 150 under a 302 window; raising the token without reparenting is inert). In `js/notifications.js`, `initToggle()` (~line 1270): (1) right after the three `getElementById` lookups, hoist both nodes once — `if (panel && panel.parentElement !== document.body) document.body.appendChild(panel); if (backdrop && backdrop.parentElement !== document.body) document.body.appendChild(backdrop);` — safe because both are `position:fixed` with no positioned ancestor dependency and every rule targeting them is id/class-based (`#notif-panel .notif-footer` at :1317 still resolves). (2) Make `openPanel()` register with Overlay so it gets the dynamic 300–398 z above whatever windows are stacked: after removing `.hidden`, do `_notifOverlayId = window.Overlay?.push?.('notif-panel', () => { panel?.classList.add('hidden'); backdrop?.classList.add('hidden'); _notifOverlayId = null; }, panel); if (panel?.style.zIndex) backdrop.style.zIndex = String(parseInt(panel.style.zIndex,10) - 1);` — guard the whole thing with the same `typeof window.Overlay?.push === 'function'` check already used at :858 and fall back to the current class toggle if absent. (3) Make every user-initiated close route through the stack instead of hiding directly: `closePanel()` becomes `if (_notifOverlayId != null && window.Overlay?.dismiss) window.Overlay.dismiss(_notifOverlayId); else { panel?.classList.add('hidden'); backdrop?.classList.add('hidden'); }` so the backdrop click (:1304), the bell's toggle-closed branch, `#notif-see-all-btn` (:1306) and the :143-144 sweep do not leave a stale stack entry that eats a Back press. If `Overlay` exposes no id-targeted dismiss, use `dismissTop()` only when the panel is in fact the top entry and fall back to the raw hide otherwise. (4) Confirm `_Z_TOKEN_VALUES` (js/app.js, the dev stacking lint) still accepts the panel now that it is a direct child of body — it whitelists the 300–398 dynamic tier, so the Overlay path passes as-is; the reparent-only fallback (bumping `--z-panel`/`--z-panel-scrim` in css/tokens.css to e.g. 400/399) would need that array updated too and is the inferior option since it would also float the dropdown above modals opened from a window. No firestore.rules/storage.rules change. Standard repo rules apply: `CACHE_VER` is derived from `APP_VERSION` and auto-bumped by the pre-commit hook, so do not hand-edit it. Verify at 1280x800 and at 800x600: open any openPage window, click the bell, confirm the dropdown paints above the window and that a single click on the topbar/nav strip still navigates.

### F15 — Desktop only: with a page window open, the profile drawer opens as a dead 56px header stub — its body (Sign Out, theme, notification settings, profile editor) and its scrim stay behind the z-302 window

**What is true**

The mechanism is exactly as reported and I confirmed every line. openProfileDrawer registers with Overlay WITHOUT an element (js/app.js:3132, `window.Overlay.push('drawer', () => closeProfileDrawer())`), so Overlay.push's `if (el) el.style.zIndex = 300 + stack.length*2` (js/config.js:1189) never runs. #profile-drawer keeps the static --z-drawer 195 (css/tokens.css:150 / css/styles.css:2624) and #drawer-overlay keeps 190 (css/styles.css:2633), while an open page window gets inline 302 (js/app.js:3892 passes `p`). Desktop-only because #topbar-menu-btn -> openProfileDrawer is wired for every role with no gate (js/app.js:972-973) and is hidden only inside @media (max-width:768px) (css/styles.css:2825), and the body.page-open occlusion (css/styles.css:3084-3087) plus Overlay._sync's cover logic (js/config.js:1354-1358) are both phone-gated, so on desktop the trigger is fully exposed while a window is up. The EFFECT lens refuted the claimed consequence, not the defect, and on the consequence it is right and I follow it: .page-panel starts at calc(--topbar-h + env(...)) = 56px (css/styles.css:2307) while .drawer is top:0 at z195 over a z100 topbar, so the ~56px .drawer-header (css/styles.css:2667-2680) and the full-viewport 190 scrim DO paint in the exposed band. The user sees the topbar dim and a "Back / Menu" bar slide into the top-right, and the first Back press visibly removes both. So "no visible change whatsoever", "no indication why the menu button did nothing" and "reads as frozen" are overstated, and the avatar path in the CLAIMED CONSEQUENCE does not exist at all — on desktop the avatar calls navigateTo('my-profile') (js/app.js:966-970). Where I do NOT follow the effect lens is its "cosmetic layering, low" conclusion. Two live behaviours survive: (1) the whole #profile-body — Sign Out, theme picker, per-type notification settings, photo/name editor — is under the opaque 302 panel and unclickable (elementFromPoint returns page-panel-body), i.e. a Menu that opens and shows nothing usable; (2) because the SCRIM is also under the panel, the window behind stays undimmed and fully interactive while Overlay believes a modal-class surface owns the top, so a click lands on the window and the next Back consumes the invisible drawer rather than the window — a genuine input/history desync, not just layering. Real, reachable, recoverable in one click, no money or access-control impact: medium. Two evidence nits: the cited js/app.js:3883 has drifted (the element-carrying page push is js/app.js:3892), and closeProfileDrawer (js/app.js:3206-3213) clears no inline z today, which matters for the fix.

**Fix**

Give the drawer the dynamic Overlay z-tier and lift its scrim with it, then clean up on close. 1) js/app.js, openProfileDrawer (line 3132): replace `if (window.Overlay && !wasOpen) window.Overlay.push('drawer', () => closeProfileDrawer());` with a version that passes the element and then raises the scrim just under it, e.g. `if (window.Overlay && !wasOpen) { window.Overlay.push('drawer', () => closeProfileDrawer(), drawer); try { const dz = parseInt(drawer.style.zIndex, 10); if (dz) overlay.style.zIndex = String(dz - 1); } catch(_){} }` — `drawer` and `overlay` are already in scope from js/app.js:2956-2957. With stack ['page','drawer'] this yields drawer 304 / scrim 303 against the panel's 302, so the drawer body paints over the window and the scrim both dims it and swallows clicks, restoring the "top of the Overlay stack is what you interact with" invariant. 2) js/app.js, closeProfileDrawer (lines 3206-3213): #profile-drawer is a persistent DOM node, so the inline z must be released or it leaks into the next open — inside the existing `setTimeout(()=>drawer.classList.add('hidden'),300)` also do `drawer.style.zIndex=''; overlay.style.zIndex='';` so the static tokens (--z-drawer 195 / --z-drawer-2 198 on phones / --z-drawer-scrim 190) govern the normal no-window case unchanged. 3) No CSS change is needed and none should be made — do NOT bump --z-drawer in css/tokens.css above --z-page-panel; that would statically outrank every page panel and break the intended ordering the token scale documents. 4) Sanity-check the phone tier after the change: the inline 300+ value now beats the ≤768px `z-index: var(--z-drawer-2)` (css/styles.css:2664), which is harmless (nothing on a phone sits between 198 and 302 that must stay above the drawer), but verify the bottom-sheet/full-screen drawer still layers correctly at 375x812 and 744px. 5) window.devCheckStacking (js/app.js:3981) already runs on every push — extend it to warn when an Overlay entry whose kind is a visible surface has `el === null`, so the next surface added this way is caught at push time. Bump handled by the pre-commit hook; no rules/index changes.

### F16 — Every openPage window is horizontally full-bleed and content-uncapped on desktop — 1888px-wide single-line inputs at 1920px, and the panel covers the sidebar nav

**What is true**

REAL, verified first-hand; overstated on impact. Confirmed in the working tree: css/styles.css:2307-2308 `.page-panel{ position:fixed; top:calc(var(--topbar-h) + env(safe-area-inset-top,0px)); left:0; right:0; bottom:0; ... z-index:var(--z-page-panel); }` — no width or max-width at ANY breakpoint (`grep -n "max-width" css/styles.css | grep -i panel` returns exactly one hit, styles.css:962, which is `--z-panel`/popover, not `.page-panel`). css/styles.css:2432-2433 `.page-panel-body` declares padding only. The only other `.page-panel*` declarations sit in `@media (max-width:768px)` (2925/2935/2973/2988/3153) and `@media (max-width:640px)` (7448 — the density pass, padding only; the finding's "7421" is off by ~27 lines, harmless). js/app.js:3769-3772 injects `bodyHTML` straight into `.page-panel-body` with no capping wrapper, and js/screens/tasks.js:1158+ writes bare `.form-group`/`.form-row` markup, where css/styles.css:327-328 sets `width:100%` and :347 `grid-template-columns:1fr 1fr; gap:12px`. Arithmetic reproduces the measurements exactly: 1920 − 32 = 1888px, (1888 − 12)/2 = 938px. The base route it replaces IS capped (css/styles.css:1227-1235 `.main-content{ margin-left:var(--sidebar-w); padding:20px; max-width:var(--content-max) }`, css/tokens.css:130/133 = 264px/1680px). Sidebar occlusion confirmed by tokens rather than assumption: css/styles.css:1046 `#sidebar{ position:fixed; top:calc(var(--topbar-h)+…); bottom:0; left:0; z-index:var(--z-shell) }` with `--z-shell:90` vs `--z-page-panel:210`. Reach is total: the panel is 141 `openPage(` call sites, and the exemplar control is ungated (js/screens/tasks.js:289 and :316 both wire `+ New Task` with no role condition, and `tasks` is in seven nav arrays in js/config.js).

Corrections I am adopting from the refuters. (1) The reach lens is right that "the only chrome left is the topbar" is imprecise — css/styles.css:5944-5952 keeps `#top-nav-strip` visible at ≥1024px because it sits above the panel's top edge. (2) The effect lens is right that that strip carries NO page tabs: js/app.js:1553-1561 `buildTopNavStrip()` writes only a brand stack, so on desktop an open window really does leave zero page navigation — but recovery is one Back click, and the panel is legitimately `role="dialog" aria-modal="true"` (js/app.js:3760), so this is ordinary modal behaviour, not stranding. (3) I drop the finding's "easy to mis-fill" claim: css/styles.css:320-322 stacks each label directly above its own control, so label→field association is width-invariant; over-wide fields hurt scan comfort and line length, not correctness. No values change, no peso path is touched. (4) Impact is therefore medium (app-wide desktop presentation), not high.

Worth flagging for whoever fixes this: the maintainer comment at css/styles.css:3066-3082 asserts ">768px the panel is NOT full-bleed" and warns "If a future change makes the desktop panel full-bleed, move this block out to the base cascade" — that claim is only true VERTICALLY (the panel starts at 56px, below #topbar). Horizontally the base rule has always been `left:0; right:0`. That stale premise is why the defect went unowned.

**Fix**

Pure CSS, no markup or JS change needed — content is injected directly into `.page-panel-body`, so cap it with padding rather than a width (capping the scroller's own width would leave an unpainted gutter and break the full-bleed background).

1. css/tokens.css — next to `--content-max: 1680px` (line 133), add a reading-measure token for windows, e.g. `--panel-content-max: 920px;` (forms are the dominant openPage payload; 920px keeps a 2-col `.form-row` cell at ~454px, close to the tablet feel the layout was designed against).

2. css/styles.css — after the base `.page-panel-body` rule (2432-2433), add a desktop-only centring pass inside a new or existing `@media (min-width: 769px)` block:
   `.page-panel-body { padding-inline: max(16px, calc((100% - var(--panel-content-max)) / 2)); }`
   This preserves the existing 16px floor at narrow widths, leaves the ≤768px and ≤640px blocks (2925+, 7448) untouched so phone/keyboard geometry and the `--kb-h` bottom calc are byte-for-byte unchanged, and needs no `env(safe-area-inset-*)` handling because those are 0 on desktop. Add the matching cap to `.page-panel-head` and `.page-panel-foot` (2329-2331, 2434-2436) with the same `padding-inline` expression so the title, Back arrow, and the Create/Cancel buttons stay aligned with the fields instead of pinning to the far screen edges.

3. Exempt the one window that already owns its geometry: `#chat-thread-panel .page-panel-body { padding-inline: 0; }` (or scope the new rule with `:not(#chat-thread-panel)`), since css/styles.css:4397-4398 already insets that panel with `left: calc(var(--sidebar-w) + 20px + 320px + 16px) !important` and chat.js hides its head (styles.css:4479). Verify the messenger input row (styles.css:5189-5223) is unaffected — it lives inside `.page-panel-body`'s scroller.

4. Fix the stale premise so this cannot regress: rewrite the comment at css/styles.css:3066-3073 to say the panel is vertically inset but horizontally full-bleed at every width, and note that the desktop `#top-nav-strip` provides brand only (js/app.js:1553) and no page tabs.

5. OPTIONAL and separable — the sidebar-occlusion half. If Neil wants the nav to stay usable while a window is open, add inside `@media (min-width: 820px)` (the width where #sidebar is not translated off — the only `translateX(-100%)` rules are styles.css:2833 under max-width:768 and :3182 under 769-819): `.page-panel:not(#chat-thread-panel) { left: var(--sidebar-w); }`. Test the rest state first: the panel sits at `transform: translateX(100%)` when closed, so with a narrower box its off-screen parking position changes — confirm no horizontal scrollbar appears on <body>. Also reconsider `aria-modal="true"` (js/app.js:3760) if the sidebar becomes reachable, since an aria-modal dialog should not leave interactive chrome outside it. This is a behaviour change, not a bug fix; ship item 2 first on its own.

6. Per CLAUDE.md, the pre-commit hook auto-bumps `APP_VERSION`/`CACHE_VER`; do not hand-edit them. Verify at 1920x1080 and 1280x800 via `openAddTaskModal()` (js/screens/tasks.js:1131) plus at least one non-form window (task detail, payslip) that the cap does not clip wide tables — those should keep their own `overflow-x:auto` container.

### F17 — 607 of 632 form labels carry no for= and no wrapping, and 0 of 718 form controls has an aria-label — every form in the app, including pre-auth login, fails programmatic label association

**What is true**

CONFIRMED by my own reading of the tree, with the counts corrected and the impact narrowed. All three lenses agreed; I re-ran every measurement rather than trusting them.

What is actually true (my counts over js/*.js + js/screens/*.js + index.html): 632 <label> elements; 3 carry for= (js/chat.js:1091, js/chat.js:1093, js/departments.js:785 — all file-attach buttons); 22 genuinely wrap their control (checkbox/radio rows, e.g. index.html:181 .remember-row, js/screens/people.js, sales.js, production.js); 607 unassociated — not the finding's 622/625, but the same defect at the same scale. 718 <input>/<select>/<textarea> tags: 0 with aria-label, 0 with aria-labelledby — that claim is exact. (The repo's ~110 aria-label attributes are all on buttons/icon controls, so the app is not blanket-unlabelled, just unlabelled on form controls.) 217 of 718 controls carry a placeholder, a weak accname fallback the finder ignored.

No runtime rescue exists: grep for htmlFor, setAttribute('for'…), or any querySelectorAll('label') post-processing returns nothing. js/app.js:3761 (openPage) and :3416 (openModal) set aria-labelledby on the dialog container only, then inject bodyHTML verbatim (js/app.js:3772 `p.querySelector('.page-panel-body').innerHTML = bodyHTML;`). Reach is total and ungated — it starts pre-auth at index.html:171-177 (`<label>Email or Username</label>` followed by a separate `<input id="email">`). The payroll editor cited is real, at js/screens/hr.js:1018-1026; the finding's 967-975 citation has drifted to the Payroll History table, and its 1062 / 1516-1521 citations contain no form markup and should be dropped.

Two overstatements, both caught by the effect lens, both of which I followed. (1) "announces as edit text, blank" is wrong for this modal — every numeric field renders value="${rec.salary||0}", so a screen reader announces the value, and the label text still precedes the control in DOM order so browse-mode reading and JAWS prompt-guessing largely recover the name. The deterministic failures are narrower: forms/tab-mode accessible name, voice-control targeting ("click Base Salary" matches nothing), and label-click-to-focus for every sighted user. (2) The money framing is unearned — nothing here causes a mis-entry; the save handler (js/screens/hr.js:1034-1063) merely has no cross-field validation, so a mis-entry would persist into salary_history and inflate effectiveGross. That is failure-to-detect, not a defect that posts a wrong amount, so money=false.

Severity dropped high → medium on that basis: breadth is 100% of forms and it is a clean WCAG 1.3.1 / 3.3.2 / 4.1.2 failure, but the concrete harm on an internal tool with no known assistive-tech users is label-click-to-focus and voice control.

The duplicate-id landmine the finding flags is real and constrains the fix: js/app.js:3779-3799 buries the previous panel via `prevTop.classList.add('page-under')` rather than removing it, so two stacked panels rendering the same input id both live in the DOM and a naive for= can bind to the hidden one.

**Fix**

Do not hand-edit 607 call sites, and do not add for="<existing id>" — the buried-panel stack (js/app.js:3779-3799) leaves duplicate ids resolvable, so for= can bind to a hidden panel's input.

1. Add a container-scoped association pass in js/app.js next to the other overlay helpers (near _focusTrapAttach, ~line 3350):

window._associateLabels = function(root){
  if(!root) return;
  root.querySelectorAll('label:not([for])').forEach(lab => {
    if(lab.querySelector('input,select,textarea')) return;   // already wrapping
    const grp = lab.closest('.form-group') || lab.parentElement;
    if(!grp) return;
    const ctrls = grp.querySelectorAll('input,select,textarea');
    if(ctrls.length !== 1) return;                            // ambiguous — skip
    const c = ctrls[0];
    if(c.getAttribute('aria-label') || c.getAttribute('aria-labelledby')) return;
    if(!lab.id) lab.id = 'lbl-' + (window._lblSeq = (window._lblSeq||0) + 1);
    c.setAttribute('aria-labelledby', lab.id);                // NOT for= — minted label ids are unique, control ids are not
  });
};

Minting a unique id on the LABEL and pointing the control at it with aria-labelledby sidesteps the duplicate-control-id problem entirely and mutates no existing id, so every document.getElementById lookup in the codebase is unaffected. (Note the trade: aria-labelledby restores the accessible name but not native label-click-to-focus; add an optional click handler in the same pass, `lab.addEventListener('click', () => c.focus())`, when the control is not already wrapped.)

2. Call it at the injection points, immediately after each innerHTML assignment:
   - js/app.js:3772, after `p.querySelector('.page-panel-body').innerHTML = bodyHTML;` → `window._associateLabels(p);` (covers the footer too since it passes the whole panel).
   - js/app.js:3383, after `modalBody.innerHTML=bodyHTML;` → `window._associateLabels(modalBody);`
   - One call at the end of navigateTo in js/app.js against `#page-content`, for inline (non-overlay) forms.

3. Fix the static login form by hand in index.html:171-177 — the ids are stable and unique, so use real for=: `<label for="email">Email or Username</label>` and `<label for="password">Password</label>`. Leave index.html:181 (.remember-row) alone; it correctly wraps its checkbox.

4. Follow-up (not required for correctness): add a `window.field(labelText, controlHTML, opts)` helper in js/config.js that emits `<div class="form-group"><label id=…>…</label><input … aria-labelledby=…>` so new screens are born associated, and migrate the highest-traffic forms — openHRProfileForm (js/screens/hr.js:2756), openPayslipGenerator, the payroll editor (js/screens/hr.js:1018-1026), openAddTaskModal (js/screens/tasks.js:1158).

5. Per CLAUDE.md this is a JS edit, so let the pre-commit hook bump APP_VERSION / the derived CACHE_VER in sw.js.

### F18 — --text-muted misses WCAG AA (4.5:1) for small text in all three themes — worst on the default Light theme (2.99–3.08:1); the AA-clearing 0.68 alpha ships only behind @media (prefers-contrast: more)

**What is true**

STANDS, verified independently rather than on the refuters' word. I recomputed the composited-alpha ratios myself: html.light --text-muted rgba(28,30,33,0.48) (css/styles.css:3277) gives 3.08:1 on --surface #FFFFFF, 3.03:1 on --bg #F7F8FA, 2.99:1 on --bg-2 #EFF1F4 (the .data-table th background); html.theme-dark 0.45 (3343) gives 3.79:1 on --surface #1A1D21 and 3.61:1 on --surface-2; html.theme-astral 0.45 (3420) gives 4.13:1. Every number in the finding reproduces to two decimals. All the cited sinks are small text (var(--fs-2xs)/--fs-xs/--fs-md = 10/11/13px per css/tokens.css:198-200), so no WCAG large-text exemption applies, and I confirmed nothing rescues them — the only other .form-group label rule (6578-6583) and .kpi-label rule (6350) set typography only, never color, and the exhaustive set of --text-muted: declarations is tokens.css:97 (beaten by the html.light class selector), styles.css:3277/3343/3420, the prefers-contrast trio at 7124/7129/7134, and 7253 inside the print block. `grep -n prefers-contrast` over css/, js/ and index.html returns exactly one hit (styles.css:7120), so there is no in-app contrast toggle: a user without OS "Increase Contrast" can never reach the compliant value. Light is the pre-paint default (index.html:37 fallback, js/app.js:1259 `setTheme(stored || 'light', false)`), so the worst-contrast theme is what everyone gets. No lens refuted it and I found no escape either.

Two corrections to the finding as written. (1) Severity is overstated at "high" and the consequence prose ("the first thing to disappear") implies invisibility — at 3.0:1 the text is legible-but-strained for normal vision; the real harm is a systemic WCAG 1.4.3 AA failure plus degraded reading for low-vision/glare/outdoor use. Nothing here is a money or security defect, so medium is the honest tier. Astral at 4.13:1 is a near-miss, not a severe failure, and is not the default. (2) Line drift: the prefers-contrast block is at css/styles.css:7120-7136, not 7093-7108; .chip-tab is at 1895; and there is no `#live-clock` selector — the element carries class="live-clock-line", styled at css/styles.css:1483-1484, which still resolves to var(--text-muted), so the substance is unchanged.

One substantive correction to what the refuters proposed as the fix: switching the text sinks to the existing --text-muted-strong is NOT sufficient. I measured it — light 0.62 clears on --surface (4.72) and barely on --bg-2 (4.51), but only reaches 4.41 on --surface-3 #E8EBEF, and dark 0.55 only reaches 4.26 on --surface-3 #2E333A, which is exactly the background .chip-tab/.tab-badge sit on (css/styles.css:1908). The already-authored 0.68 value clears everywhere (5.31 light / 6.31+ dark on surface-3), so the fix is to promote the prefers-contrast values into the base theme blocks, not to reuse --text-muted-strong.

**Fix**

Single-file token fix in css/styles.css — no per-component CSS churn, since every sink already reads var(--text-muted).

1. Raise the base alphas in the three theme blocks to the values the app already authored for high-contrast mode:
   - line 3277, inside `html.light {` (3267): `--text-muted: rgba(28,30,33,0.48);` -> `rgba(28,30,33,0.68);` (measured 5.75 on #FFFFFF, 5.60 on --bg, 5.45 on --bg-2, 5.31 on --surface-3 — clears AA on every surface the token is painted on).
   - line 3343, inside the `html.theme-dark` block: `rgba(228,230,235,0.45)` -> `rgba(228,230,235,0.68)` (6.91 on --surface, 6.31 on --surface-3).
   - line 3420, inside `html.theme-astral {` (3410): `rgba(240,240,250,0.45)` -> `rgba(240,240,250,0.62)` minimum; 0.68 to match the others. Also mirror the same value into css/tokens.css:97 (`--text-muted: rgba(240,240,250,0.45)`), the :root fallback, so a pre-theme-class paint is not below floor.

2. Do NOT use --text-muted-strong (3278 / 3344 / 3421) as the remediation token: at 0.62/0.55/0.50 it fails on --surface-3 (4.41 light, 4.26 dark), which is where .chip-tab (css/styles.css:1895, background --surface-3 at 1908) and .tab-badge render. Leave --text-muted-strong wired to .badge-gray (197, 3487) as-is, or collapse it into --text-muted once the base is raised, since 0.68 supersedes it.

3. The `@media (prefers-contrast: more)` block at css/styles.css:7120-7136 becomes a no-op for --text-muted once the base matches. Either drop the three `--text-muted:` lines from it (keeping the --border / --border-strong raises, which are still meaningful) or push them to ~0.80 so the high-contrast tier remains a real step up. Keep the block itself.

4. Visual-hierarchy side effect to check while editing: at 0.68, light --text-muted sits very close to `--text-2: rgba(28,30,33,0.72)` (3272), compressing the three-level text ramp to nearly two. If the design needs separation preserved, darken --text to a fuller value or move --text-2 up in the same commit — but do not solve it by leaving --text-muted below 4.5:1.

5. Per CLAUDE.md, this is a CSS edit: let the pre-commit hook bump window.APP_VERSION in js/config.js (CACHE_VER in sw.js derives from it) so the service worker does not serve the stale stylesheet. Verify by loading the app with OS Increase Contrast OFF on the default Light theme and sampling .form-group label, .data-table th, .kpi-label, .chip-tab, .att-cal-hdr and .live-clock-line.

### F19 — Team-directory role labels use hardcoded dark-theme hexes; in the default Light theme all 7 role colours fail WCAG AA (finance #FFD60A ≈ 1.25:1, effectively invisible)

**What is true**

Confirmed by my own read of the files, not by vote count. js/screens/people.js:920 holds the literal map `{president:'#9BA8FF',manager:'#30D158',finance:'#FFD60A',employee:'#0A84FF',agent:'#FF9F0A',partner:'#FF6B6B'}` with a `'#8E8E93'` fallback, injected as an inline `style="color:${badgeColor}"` at js/screens/people.js:959. `.team-member-role` (css/styles.css:3804-3807) declares no `color`, so the inline literal is the only colour source and nothing overrides it — there is no `html.light .team-member-role` rule anywhere in css/, and neither the `forced-colors` nor the `prefers-contrast` block reaches it. Light is the hard default (js/app.js:1259 `setTheme(stored || 'light', false)`, js/app.js:1267 `if (!THEMES[theme]) theme = 'light'`), `html.light { --surface-2: #F2F4F7; }` (css/styles.css:3271) and `.team-member-card { background: var(--surface-2); }` (css/styles.css:3724) make the card exactly the rgb(242,244,247) the finder measured. Screen is live and routed: js/app.js:2415 `case 'team-directory': window.renderTeamTab?.()`, with nav entries at js/config.js:500/518/529/547/564.

I recomputed every ratio against #F2F4F7 myself and the finder's three numbers reproduce exactly (finance 1.28, president 2.02, employee 3.31). The `opacity: .85` on css/styles.css:3806 — which the finding omitted — makes it slightly worse, not better: finance 1.25, manager 1.71, agent 1.71, president 1.81, partner 2.22, fallback 2.45, employee 2.79. At 10px/700 this is normal text, so the AA floor is 4.5:1 and all seven fail. No lens refuted it and I could not either.

Two corrections to the finding's framing, both of which I follow. (1) Severity is medium, not high: it is a pure readability/a11y defect with no money or security dimension, the card still renders name, avatar, department line and presence, and switching to a dark theme restores it — but it is at the top of medium because the finance badge is genuinely unreadable for every user on the default theme. (2) "The one piece of information the card exists to convey is invisible" is overstated, and "invisible" is only literally true for finance/manager/agent; president, partner, fallback and employee are legible-but-substandard. Scope additions the finding missed: `secretary` (js/config.js:381) has no entry in the map and falls to the #8E8E93 default at 2.45:1, and the Brilliant-Steel-only sidebar (js/config.js:534-540) has no team-directory entry so that one cohort is unaffected.

Notably, the repo already solved this exact class of problem elsewhere: `window.ROLES[role].badge` maps each role to a `badge-*` class, and css/styles.css:3486-3492 carries a `html.light` AA pass over those classes (including an explicit "v14 a11y fix" comment on badge-teal). The Team card simply bypasses that system with raw hexes.

**Fix**

Stop emitting a theme-invariant hex and route the role colour through a theme-aware CSS hook. Two viable shapes; prefer A because it preserves the current plain-coloured-text look rather than turning the line into a pill.

A. Role modifier classes (minimal visual change)
1. js/screens/people.js — inside `renderTeamCards` (defined at :900), delete the `badgeColor` const at :920 entirely.
2. js/screens/people.js:959 — change
   `<div class="team-member-role" style="color:${badgeColor}">${roleLabel}${isMe?' · You':''}</div>`
   to
   `<div class="team-member-role team-member-role--${escHtml(u.role||'unknown')}">${roleLabel}${isMe?' · You':''}</div>`
   (escape it — `u.role` is Firestore-sourced and is being interpolated into an attribute).
3. css/styles.css — next to the `.team-member-role` rule at :3804, add one modifier per role using the existing dark hexes as the base, then an `html.light` block beside the badge overrides at :3486-3492 with AA-passing darkened variants, e.g. `html.light .team-member-role--finance { color:#7A6000; }`, `--manager #1A8838`, `--agent #BA5D00`, `--president #4B58C8`, `--partner #C42B22`, `--employee #0055CC`, `--secretary` (gold) `#7A6000`, and a `--unknown/default` at `var(--text-muted-strong)`. Verify each lands ≥4.5:1 against #F2F4F7 before committing — the same script I used works: relative luminance, `(L1+0.05)/(L2+0.05)`.
4. css/styles.css:3806 — drop `opacity: .85` from `.team-member-role` (or fold the intended softening into the chosen hex). Leaving it composites every colour 15% toward the card and silently eats ~0.2-0.5 of whatever ratio you tune to.
5. Add a `secretary` case so it stops falling through to the grey default, and keep the default branch for any unknown role.

B. Reuse the existing badge system (less new CSS, changes the visual to a chip)
Replace :959 with `<span class="badge ${window.ROLES?.[u.role]?.badge || 'badge-gray'}">${roleLabel}${isMe?' · You':''}</span>` and delete :920. This inherits the already-AA-passed `html.light .badge-*` overrides for free. If you take this route, first add a `html.light .badge-gold` colour — `--gold` is not defined in the `html.light` block, so `.badge-gold { color: var(--gold) }` (css/styles.css:602) currently resolves to nothing and the secretary chip inherits its parent colour.

Either way: bump `window.APP_VERSION` via the normal pre-commit hook (do not hand-edit) so `CACHE_VER` in sw.js follows and the service worker does not serve the stale people.js/styles.css. Also spot-check Light at 375px, since the finder reproduced the failure at both 1280 and 375.

Out of scope for this fix but adjacent and worth a separate ticket: `.team-member-dept` (css/styles.css:3808) uses `var(--text-muted)` = rgba(28,30,33,0.48), which computes to roughly 3.0:1 on the same #F2F4F7 card and also fails AA at that size.

### F21 — The single global toast clips long messages to one un-scrollable line, self-destructs in 3.5s with no dismiss control, and its lone aria-live region is populated before insertion so screen readers may never announce it

**What is true**

The mechanism is real and I verified every line myself in js/notifications.js showToast() (1052-1110): `white-space:nowrap; max-width:90vw; overflow:hidden; text-overflow:ellipsis` at :1099 (mirrored on the label at :1104), unconditional `setTimeout(() => toast.remove(), 3500)` at :1109 for every type including 'error', no dismiss button, no tabindex, no focusable child (only `dot` and `label`), and `role="status"`/`aria-live="polite"` set at :1085-1086 on a DETACHED node whose text is written at :1105 before `document.body.appendChild` at :1108 — a live region inserted already containing its text is not reliably announced, and :1062 tears out the previous node so a fresh region is minted every time rather than a stable one being mutated. Repo-wide grep confirms this is the ONLY aria-live/role=status/role=alert in the app, and `grep '\balert(' js/*.js` returns zero, so there is no second textual channel.  WHAT I DID NOT FOLLOW: the a11y and reach lenses both voted STANDS at the finder's "high / a failed save reads as a successful one" framing, and I am rejecting that clause — the effect lens is right and I checked its two anchor sites. js/screens/hr.js:2274-2277 emits `Notifs.success('Payroll disbursed!')` only INSIDE the try after the await, then unconditionally calls loadPayRunStrip(month), which re-reads pay_runs from Firestore and repaints "💵 Disburse" for state==='verified' and the "Disbursed by …" line only for state==='disbursed'; a rules rejection therefore leaves a permanent on-screen contradiction of success. js/config.js:2374-2379 puts closeModal() inside the try, so a rejected cash advance leaves the form open with the typed values. So no peso moves silently and no failure is invisible. WHAT SURVIVES, and why it is still a real medium bug: (1) the a11y core — the live region is functionally unreliable and it is the app's only one, so blind users may get NOTHING at all, not a truncated something; (2) the diagnostic tail is destroyed and unrecoverable — the leading "Action failed: " / "Save failed: " prefix survives ellipsis, but the actual reason does not, and there is no dismiss, no replay, no persistent log (js/errlog.js writes silently to Firestore); (3) the clearest real repro is not an error at all but the 115-char instructional toast fired automatically on iPhone at js/notifications.js:1352 and the 108-char one at :772 — "On iPhone, first tap Share → Add to Home Screen, then open the app…" is clipped to roughly its first half on a 375px viewport, so the instruction is literally unreadable on the exact device it targets. Two of the finder's specifics are wrong and I discarded them: the reproduction string 'Failed to save payroll: Missing or insufficient permissions. Contact the President.' does not exist anywhere in the tree (real literals run 60-115 chars, e.g. js/print-docs.js:457, js/svc-approvals.js:64, js/departments.js:36 `Action failed: ${e.message}`), and the 3500ms line is :1109, not :1108.

**Fix**

All edits are in js/notifications.js, inside/around showToast() (1052-1110), plus the style block at 1362-1364. Bump APP_VERSION/CACHE_VER per the repo's hook rules.  (1) Stable live region — stop minting a new one per toast. Add a module-level `let _liveRegion = null;` and a `_ensureLiveRegion()` that, on first call, appends an EMPTY `<div id="bi-toast-live" role="status" aria-live="polite" aria-atomic="true">` to document.body with visually-hidden styles (`position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;`). In showToast, after `document.body.appendChild(toast)` at :1108, do `_ensureLiveRegion(); _liveRegion.textContent = ''; requestAnimationFrame(() => { _liveRegion.textContent = message; });` — the region pre-exists in the DOM and mutates, which is what AT actually observes. Then DROP `role`/`aria-live` from the visual toast at :1085-1086 (replace with `toast.setAttribute('aria-hidden','true')`) so the message is not double-announced. For type==='error'/'danger' use `aria-live="assertive"` on a second hidden region, or flip the single region's aria-live before writing.  (2) Let text wrap. In the :1092-1100 cssText, replace `white-space:nowrap; max-width:90vw; overflow:hidden; text-overflow:ellipsis;` with `white-space:normal; overflow-wrap:anywhere; max-width:min(92vw,420px); text-align:left;` and change `border-radius:999px` to `border-radius:14px` (the pill radius is wrong once the toast is multi-line) and `align-items:center` to `align-items:flex-start` with `dot` given `margin-top:4px`. Delete the label's `label.style.cssText = 'overflow:hidden; text-overflow:ellipsis;'` at :1104 entirely, or swap it for a 4-line cap: `display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden;`.  (3) Dismissible + type-aware lifetime. Build a real `<button>` (not a span) with `type='button'`, `aria-label='Dismiss notification'`, visible × glyph, `flex-shrink:0`, min 32x32px hit area, `background:none;border:0;color:inherit;cursor:pointer;`, appended after `label`; its click handler clears the pending timer and removes the toast. Replace the flat :1109 timeout with `const ttl = (kind === 'error') ? 12000 : 3500; let timer = setTimeout(() => toast.remove(), ttl);` and add `toast.addEventListener('mouseenter', () => clearTimeout(timer));` plus a matching `mouseleave`/`focusin`/`focusout` pair to pause-on-hover-or-focus, so a keyboard user who tabs to the dismiss button is not raced by the timer. Store the timer on the node (`toast._t`) and `clearTimeout(existing._t)` next to the `existing.remove()` at :1062 so the outgoing toast's timer cannot kill its replacement.  (4) Recovery channel for errors. In showToast, when kind==='error', also `console.error('[toast]', message)` and push the string onto a bounded `window.Notifs._recentErrors` ring buffer (cap ~20, with a timestamp) exposed on the returned object at :1344, so a truncated or missed reason is retrievable — optionally surfaced in the existing Notifs inbox renderPage.  (5) Shorten the two worst offenders at their source: js/notifications.js:772 and :1352 should be trimmed to roughly 60 chars or moved into a real modal/prompt rather than a toast, since they are multi-step instructions, not status.

### F23 — Offline/failed profile load silently fabricates a bare 'employee' profile and boots the app — which then strands the user behind the undismissable, offline-unsatisfiable "Profile photo required" gate (NOT a privilege or offboarding bypass)

**What is true**

The mechanism the finding describes is real and verbatim in the tree: js/app.js:902 does a bare default-source `db.collection('users').doc(user.uid).get()`; the catch at js/app.js:945-951 swallows ANY failure (offline-uncached read, the `_counters` transaction at :905-910, the profile `.set()` at :919) with nothing but a `console.error`, fabricates `{displayName:user.email, role:'employee', departments:[]}`, calls `applyUserUI()`, and boot continues unguarded into showApp()/buildNav()/navigateTo() at js/app.js:180-192. There is no offline gate anywhere in app.js (`grep navigator.onLine js/app.js` → zero hits) and no user-visible signal at all.

But BOTH claimed consequences are wrong as written, and I follow the effect lens on both:

(1) "Demoted to bare employee" is not a privilege defect — it is fail-CLOSED (employee is the floor), it writes nothing (the only users-doc writes reachable off that state are `.update({photoUrl})` at js/app.js:1026 and `.update({phone})` at js/app.js:2947), and it self-clears because `loadUserProfile` runs at js/app.js:122 ABOVE the `_bootstrappedUid` guard at :144, so the next online auth fire repopulates. Firestore rules also independently block a client from writing its own `role` (firestore.rules userPrivilegedFieldsUnchanged, ~:108-118), so even the theoretical `!snap.exists` → `set({role:'employee'})` overwrite of a President's doc on a mid-boot reconnect would be denied.

(2) The offboarding-bypass half is materially false. Offboarding no longer flips a client-side flag: js/screens/people.js:1040-1042 calls the `setUserDisabled` callable, and functions/index.js:389-390 does `admin.auth().updateUser(targetUid,{disabled:true})` + `revokeRefreshTokens(targetUid)`. There is no "full old role for the next 10 days" — the account cannot refresh its token or re-login the instant it touches the network. The residual is only: a device already holding a warm IndexedDB cache and an unexpired ID token can, in airplane mode, repaint its pre-offboarding role and re-read documents it had ALREADY cached while legitimately employed. That is device-local data retention, not live escalation, and the `removed` gate never had power to purge it anyway (`grep clearPersistence|terminate()|indexedDB.deleteDatabase js/ sw.js` → zero hits; the cache survives every sign-out, removed or not).

What actually bites, and what neither the finding nor the code lens caught: the fabricated profile has no `photoUrl`, so js/app.js:986-988 fires `setTimeout(requireProfilePhoto, 800)` for every non-partner. `requireProfilePhoto` (js/app.js:993-1038) appends a fixed inset:0 overlay at `--z-splash` with NO close button, no ESC handler, and the only exit is an upload that calls `Drive.uploadProfilePhoto` → Firebase Storage, which cannot succeed offline. So a user whose real profile HAS a photo gets hard-locked out of the offline PWA by a photo gate they already satisfied. That is a genuine availability defect in the app's core offline promise — medium, UX/availability, not security or money. Reach note: a returning user's users-doc is normally cached, so the throw path needs IndexedDB persistence to be absent or evicted (private browsing / `unimplemented` / `failed-precondition` at js/firebase-config.js:78-89) while Auth persistence survives — an edge storage condition, not "the President in a dead zone" — but the same catch also fires on any non-offline throw, so it is not offline-only.

**Fix**

Three edits, all in js/app.js plus one in the removed-user path. Bump APP_VERSION/CACHE_VER per repo rules.

1. js/app.js `loadUserProfile` (:893-952) — stop fabricating a profile on failure. Replace the catch body at :945-951 with: try a cache read first, then flag the failure instead of inventing a role.
   ```js
   } catch(err) {
     console.error('Profile load error:', err);
     try {
       const c = await db.collection('users').doc(user.uid).get({ source: 'cache' });
       if (c.exists) { userProfile = { id:c.id, ...c.data() }; currentRole = userProfile.role||'employee'; /* depts as in the happy path */ ... applyUserUI(); return; }
     } catch(_) {}
     userProfile  = { displayName: user.email, role: 'employee', departments: [], email: user.email, _degraded: true };
     currentRole  = 'employee';
     currentDepts = [];
     window.userProfile = userProfile;
     applyUserUI();
   }
   ```
   Also guard the auto-create branch: before the `_counters` transaction at :905, bail out if the read came from cache — `if (!snap.exists && snap.metadata && snap.metadata.fromCache) throw new Error('profile-unavailable-offline');` — so a mid-boot reconnect can never run `set({role:'employee'})` over a real user's doc (defense-in-depth behind the rules).

2. js/app.js auth handler (:119-139) — handle the degraded case explicitly instead of booting a fake app. After `await loadUserProfile(user)` and before the removed gate at :135, add:
   ```js
   if (userProfile && userProfile._degraded) {
     showProfileUnavailableScreen(user);   // new, modelled on showRemovedUserScreen (:689-711)
     return;                                // do NOT showApp()/buildNav()/navigateTo()
   }
   ```
   The new screen: "Can't load your account — you appear to be offline" + a Retry button that re-runs `loadUserProfile(auth.currentUser)` and re-enters the flow, plus a Sign Out button. Do NOT sign the user out automatically (offline sign-out is unrecoverable until they get signal back). Keep it visually consistent with showRemovedUserScreen.

3. js/app.js `applyUserUI` (:986-988) — never fire the blocking photo gate on a profile we did not actually load:
   `if (!userProfile._degraded && !userProfile.photoUrl && currentRole && currentRole !== 'partner') setTimeout(requireProfilePhoto, 800);`
   Additionally in `requireProfilePhoto` (:993), early-return when `navigator.onLine === false`, and re-arm it on the `online` event, so a mid-session network drop can't strand a genuinely photo-less user either.

4. Cache hygiene on offboarding — js/app.js `showRemovedUserScreen` (:689-711), in the Sign Out handler at :707-710 (and at the automatic sign-out at :137): after `auth.signOut()`, purge the local Firestore cache so an offboarded device retains no company data:
   ```js
   try { await auth.signOut(); } catch(_){}
   try { await db.terminate(); await db.clearPersistence(); } catch(_){}
   window.location.reload();
   ```
   (order matters — `clearPersistence()` throws unless the client is terminated first; wrap in try/catch since it fails if another tab holds the lock). This is the correct fix for the residual half of harm (2); the `removed` gate itself is not the lever.

### F27 — restore.yml: a blank `collection` input silently means ALL collections, and there is no never-restore list — an intentional single-collection restore merges a full month snapshot over live data and republishes revoked public_quotes links

`MONEY` `SECURITY`

**What is true**

The mechanism is real and I confirmed every link in the chain first-hand, but the finding's headline consequence is wrong and I followed the `effect` lens on that point. The write path is fail-CLOSED, not fail-open: restore.yml:6 `commit` is a free-text input (not a dropdown) pre-filled with '0' and labelled 'Type EXACTLY "1" to write'; restore-from-backup.js:34 does a strict `=== '1'` on the trimmed value, and every write (lines 83, 87, 100, 107, 111) is inside `if (COMMIT)`, with a `🔴 COMMIT (writes Firestore)` banner at :119 and per-collection doc counts at :177. So "a single mis-typed dropdown silently rolls the company back" does not happen — a mistype yields a dry run that writes nothing and prints exactly what a real run would touch. The `code` and `reach` lenses were right that nothing was fixed or unreachable, but neither tested the accident story, which was the finding's actual claim.

What survives is narrower and still real. Given a deliberate `commit=1` run — the tool's advertised purpose — line 174 `if (ONLY && collection !== ONLY) continue;` is a no-op when the OPTIONAL `collection` input is left blank, so one forgotten field silently escalates a single-collection repair into a full-database merge. restoreCollection line 107 `batch.set(ref, revive(rest), { merge: true })` runs through the Admin SDK (initializeApp with a service-account cert at :23-28), so firestore.rules cannot intervene at all. monthly-backup.js:474 `db.listCollections()` + :197 `EXCLUDE = new Set(['notifications'])` + :245 unfiltered `.get()` means the folder holds a FULL current-state snapshot of every root collection, and restore has only four skips (`_manifest.json`, manifest `report:true`, legacy `collection.includes('/')` exports, and `attendance`) plus a max() special case for `_counters` — no exclusion list for anything else. Concretely: a payroll base raised ₱25,000→₱30,000 after the snapshot is merged back to ₱25,000; docs deleted since are recreated. The sharpest case is confirmed: revokeQuoteShare (js/screens/sales.js:2415-2420 — the finding's line 2389 has drifted to 2416) deletes `public_quotes/{token}` AND strips `shareToken` from the source quote; a restore recreates both, and firestore.rules:1880-1882 is `allow get: if true`, so a deliberately killed client link is publicly live again with pricing, and with `bankDetails` if respondToQuote revealed them (functions/index.js:1430) before the snapshot. Two scope corrections I accept from the refuters: the snapshot labelled "2026-06" is taken ~1 July (Phase 89 full current-state), so it reverts ~5 weeks and can only resurrect links revoked AFTER that run, not before; and `presence` is not a real root collection (monthly-backup.js:190-196) so drop it from the affected list. The "no environment: / no required reviewer" complaint is nominal — I confirmed grep for `environment:` across .github/workflows/ returns nothing, but the only two accounts with push are the owner's, so a GitHub gate would be self-approved; its value here is the forced second click and audit record, not real separation of duties. One extra wrinkle neither lens raised: `merge: true` cannot remove fields, so a restore also leaves a hybrid state where post-snapshot field deletions are never undone. Downgrading high → medium: real, irreversible, money- and exposure-relevant, but it requires an operator to be deliberately performing a restore, and the dry-run default already prints `public_quotes` in the preview.

**Fix**

1. Make "all collections" impossible to select by omission. In `.github/workflows/restore.yml`, change the `collection` input to `required: true` with `description: 'Collection name, or the literal ALL'`. In `scripts/restore-from-backup.js` near line 33, replace `const ONLY = (process.env.RESTORE_COLLECTION || '').trim();` with a parse that hard-exits when the value is empty: `if (!RAW) { console.error('❌ RESTORE_COLLECTION is required — name one collection, or pass ALL deliberately.'); process.exit(2); }` and set `const ALL = RAW === 'ALL'; const ONLY = ALL ? '' : RAW;`. Keep line 174's `if (ONLY && ...)` as-is — it then only skips nothing when ALL was typed on purpose.

2. Add a never-restore list. In `scripts/restore-from-backup.js`, next to the ONLY/COMMIT constants add `const NEVER_RESTORE = new Set(['public_quotes','order_tracking','system_health','notif_quota','notif_push_quota','audit_log']);` and, in the main loop right after `const collection = entry ? entry.collection : basename;` (just before line 174), insert `if (NEVER_RESTORE.has(collection) && collection !== ONLY) { console.log('\n⏭️  ' + collection + ' (never restored in an ALL run — pass it as RESTORE_COLLECTION explicitly)'); continue; }`. This is the single edit that closes the revoked-quote-link resurrection: `public_quotes` is a derived public mirror, never a restore source, and `order_tracking` is likewise publicly gettable.

3. Snapshot before overwriting. In `restoreCollection` (and `restoreSubcollection`), when `COMMIT` is set, first `await db.collection(name).get()` and upload the serialized current state to a `Monthly Backups/_pre-restore-<ISO timestamp>/<name>.json` folder via the existing drive-lib helpers, before the first `batch.commit()`. Abort the whole run (`process.exit(3)`) if that pre-restore write fails — no rollback of a rollback exists today.

4. Make the confirm string non-reusable. Change restore.yml's `commit` description/default to require the month, e.g. `RESTORE <YYYY-MM>`, and at restore-from-backup.js:34 make it `const COMMIT = (process.env.RESTORE_COMMIT || '').trim() === ('RESTORE ' + MONTH);` so a remembered "1" from a prior run cannot commit the wrong month.

5. Optional, low cost: add `environment: production` to the `restore` job in restore.yml. Self-approved at this collaborator count, but it forces a second explicit click and records the approval in the Actions audit trail.

No change is needed in `js/screens/sales.js:2415` or `firestore.rules:1880` — the revoke and the public get rule are both behaving as designed; the defect is that the restore tool writes past them.

### F28 — executeApprovalOnUpdate silently flips a human-approved ca_deduct request to 'rejected' when the CA balance drops between filing and approval — employee is pushed "✅ Approved", nobody is told, System Health still says 'ok', and the branch is redundant because both the else-branch and planFor already clamp

`MONEY`

**What is true**

The defect is real and reachable, but the headline and the impact rating were both wrong; I follow the effect lens on severity and the reach lens on the trigger condition.

WHAT IS TRUE (verified in the tree): functions/index.js:1105-1115 rejects on `requestedAmount > caBalance + 0.01`, writing only a doc update + console.warn — no notification to requester, approver or President, and it is the only Cloud Function trigger on approval_requests (one hit for `.document('approval_requests/{id}')`). stats.errors is untouched there, so reportHealth (functions/index.js:628-638, called at :1130) stamps lastStatus:'ok'. js/config.js:2650 filters `status=='approved'`, so the rejected doc drops out and payroll falls back to the installment plan at :2663-2668. The client approve handler (js/screens/approvals.js:508-511) writes status only — no appliedBy — so the trigger guard at :1074 does not block it, and the same click pushes the employee "✅ CA Deduction Approved" for a request the server is about to mark rejected. The write happens on the Admin SDK, so firestore.rules cannot stop it.

WHAT THE FINDING GOT WRONG (reach lens, which I follow): the two-centavo/rounding scenario is NOT reachable. js/screens/dashboards.js:2922 blocks `amt > totalBal` at file time and both sides sum the same `balance` fields (client filters balance>0 at :2830, server sums all approved rows), so float noise never approaches the 0.01 epsilon. The reachable trigger is a balance drop between filing and approval — Finance's Record Payment (js/config.js openPaymentModal → recordPayment) or a payroll disbursement (CashAdvance.deduct, js/config.js:2701) landing while the request sits pending — or a request written outside the UI (rules enforce only isNonNegNumber on amount). "REPRODUCED" also overstates it: there is no test harness here; it is arithmetic against the read source.

WHAT THE FINDING GOT WRONG (effect lens, which I follow on severity): "the payslip is wrong by ~₱10,000" is false. The payslip correctly reports what was deducted; the shortfall stays on cash_advances.balance and keeps amortising. totalPayable/monthlyPayment are frozen at CA-approve time (js/config.js:2396-2404) and nothing re-accrues, so neither side loses money — it is a one-run settlement-timing miss, not a wrong ledger. I do not follow the effect lens all the way to REFUTED, though: it changes the peso amount deducted from that run's pay away from what a President actually authorised, which is a money-affecting behaviour even if net-zero over the life of the receivable (and it matters concretely for a final-pay/settlement run, where "next month" may not exist).

WHAT SURVIVES, AND WHY IT IS STILL WORTH FIXING: a server job silently inverts a human approval decision, contradicts the notification the employee just received, is invisible on the Approvals History row (js/screens/approvals.js:820 shows only the badge), and its `reviewNote` is read by no client code anywhere in the repo (grep: only functions/index.js:1090 and :1113 write it, nothing reads it). The System Health 'ok' is defensible on its own — stats.errors counts exceptions — but combined with the missing notification there is no channel at all through which the inversion surfaces. And the branch is unnecessary, as the finding itself notes: the else-branch clamps with Math.min (functions/index.js:1117) and planFor independently clamps with `Math.min(customAmount, caBalance)` against a fresh balance (js/config.js:2660), so an over-balance request would already be handled correctly with no rejection. Confirming this: `appliedAmount`/`appliedBy` appear nowhere under js/ — planFor reads `amount` — so the entire server re-derivation has exactly one observable effect on the app, and it is the destructive one.

**Fix**

Primary (preferred, smallest and safest) — stop rejecting; clamp and tell someone. In functions/index.js, `exports.executeApprovalOnUpdate` (~lines 1105-1125), delete the `if (requestedAmount > caBalance + 0.01) { ... status:'rejected' ... }` branch and always take the clamp path:

  const appliedAmount = round2(Math.min(requestedAmount, caBalance));
  const clamped = requestedAmount > caBalance + 0.01;
  await change.after.ref.update({
    appliedBy: 'server', appliedAmount,
    appliedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(clamped ? { clampedFrom: requestedAmount, reviewNote: `Clamped: requested ₱${requestedAmount.toFixed(2)} exceeds current CA balance ₱${caBalance.toFixed(2)}; ₱${appliedAmount.toFixed(2)} will be deducted.` } : {})
  });

The request stays `approved`, so js/config.js planFor still finds it and its own `Math.min(customAmount, caBalance)` at line 2660 clamps against the balance as of Compute time — which is fresher than the trigger's anyway. Status never contradicts the "✅ CA Deduction Approved" push at js/screens/approvals.js:510.

When `clamped`, also write notifications (the trigger already has `db`; follow the pattern used elsewhere in functions/index.js — write to `notifications/{uid}/items`): one to `after.userId` and one to `after.approvedBy` (and/or the President uid), body = the reviewNote text, type 'ca_deduct_reviewed', link 'personal-finance' / 'approvals'. Bump `stats.notified` accordingly.

If Neil wants to keep an auto-reject at all (do NOT default to this): then in the same branch (a) write the two notifications above before returning, (b) add a distinct counter — `stats.autoRejected = 1` — and extend reportHealth at functions/index.js:628-638 to spread it (`...(stats.autoRejected ? { autoRejected: stats.autoRejected } : {})`) and to set `lastStatus: stats.errors > 0 ? 'error' : (stats.autoRejected ? 'warn' : 'ok')`, and (c) surface `reviewNote` in the UI — js/screens/approvals.js history rows (~line 851 mapper / ~1098 badge) and the ca_deduct row detail at ~line 357, so the "why" is readable somewhere.

Independent of which path is taken, close the notification lie at js/screens/approvals.js:508-511: the "✅ CA Deduction Approved" push is sent before the server has evaluated the request. Either move it behind an onSnapshot/re-read of the doc after the trigger settles, or soften the body to "approved — the exact amount is confirmed when payroll is computed".

No firestore.rules or index changes are needed. Deploy with `cd functions && npm run deploy`; no CACHE_VER bump for the functions-only change, but bump/commit normally if approvals.js or config.js is touched.

### F29 — openConversation has no generation guard across its `await _myReadAtForOpen` — a superseded conversation's listeners attach late and paint its messages into the conversation actually on screen, so replies (and swipe-reply snippets) go to the wrong thread

**What is true**

The core defect is real and I confirmed it line-by-line in the current tree, not from the refuters' summaries. `openConversation` (js/chat.js:1697) assigns `_openConvId`/`_openConv` at 1714, then awaits `_myReadAtForOpen` at 1733, and 1756-1795 attaches three `onSnapshot` listeners plus `_typingExpireTimer`/`_presenceTimer` with NO `_openConvId !== convId` re-check. `_myReadAtForOpen` (1689-1696) does a real network `get()` of `conversations/{id}/readers/{uid}` whenever `conv.reads[uid]` is absent — i.e. exactly the never-opened/unread rows a user clicks — so the window is a round-trip wide, not a microtask. Open A then B inside that window and A's continuation attaches A's listeners while B's panel is mounted; A's message snapshot runs `_msgs = <A's msgs>; _renderThread()` (1760-1762), and `_renderThread` (4926-4929) resolves the single global `#chat-thread-scroll` with no conversation identity check. Because `_buildThreadPanel` passes `replace: alreadyOpen` (chat.js:1113-1118) and openPage's doReplace branch does `prevTop.remove()` (js/app.js:3750), exactly one scroller exists and it is B's — so A's content renders under B's header/avatar. `canPatch` (4941) fails across conversations, so it is a FULL `el.innerHTML = _threadHtml(list)` rebuild that wholly replaces B's messages, and it is sticky: B's readers/typing listeners re-render the same stale `_msgs`, so it only self-corrects when a new message lands in B or the panel closes. Meanwhile `sendMessage` uses `conv = convParam || _openConv` (1939) = B, and `_replyTarget` armed by swipe/long-press on one of A's displayed bubbles (3861) is written into B as `msgDoc.replyTo = {author, snippet}` (2002) — that is a genuine outbound copy of A's author name and 80 chars of A's text into conversation B, visible to B's participants. `loadEarlier` (2211) also pages B with a `startAfter` cursor snapshot taken from A.

Corrections I am adopting from the lenses, all three of which I re-verified rather than accepted:

1. NOT a permanent listener leak. B's `teardownThread()` ran BEFORE A resumed and re-created the array (`_threadUnsubs = []`, chat.js:251), so A's late `push`es land in B's live array and are unsubscribed at the next thread close. Only the two single-slot interval handles leak permanently (1795 and 2257 overwrite without clearing; teardown at 279-280 can only clear the last-assigned one).

2. The "permanent Firestore read every 30 s" claim is wrong. The leaked `paint` bails at 2248 (`const el = document.getElementById('chat-presence-label'); if (!el || !otherUid) return;`) before touching `dbCachedGet`, so it costs nothing while no DM is open. The real residual harm is that once ANY later DM is open, the orphaned interval paints conversation A's counterpart's online dot and label into that unrelated DM's header, racing the legitimate timer. Same shape for the leaked `_typingExpireTimer`, which no-ops at 2188.

3. The read-receipt claim is inverted, not merely overstated. `_markRead()` stamps `_openConvId` (1800/1818), which is B — the thread on screen and already marked read. Conversation A, whose messages are displayed, is the one that is NOT marked read. The only genuine receipt defect is that A's continuation re-sets `_initialMarkReadPending = true` at 1739 and then falls to the `else` at 1778-1780 without clearing it, so B's next snapshot takes the 1775 branch and calls `_markRead()` directly, bypassing the at-bottom gate at 1833 — a message can be marked seen while the reader is scrolled up.

4. Reach is narrower than "any user, any tap", and I checked the CSS rather than taking it on faith. The two-inbox-row interleave needs >768px: `body.page-open .main-content { visibility: hidden }` sits at css/styles.css:3086 inside the `@media (max-width: 768px)` block only, and at >=1024px the inbox is a persistent 320px column (css/styles.css:4382-4400) beside the thread panel, so clicking row A then row B is an ordinary desktop interaction. On phones the mobile-reachable variants are the push deep link (js/notifications.js:147) and in-app search (js/chat.js:5163) firing during a pending readAt. The fast path (`conv.reads[uid]` present) is genuinely not exploitable — a microtask resolves before the next click's task.

Severity is medium, not high. No privilege boundary is crossed (the viewer is a participant of both conversations, firestore.rules:554-569), nothing unauthorized is disclosed by the render itself, and the worst outcome — a reply landing in the wrong thread, or A's `replyTo.snippet` persisted into B — requires the user to then send. But it is a live wrong-recipient-message path in a system carrying HR, payroll and partner-pricing DMs, it is sticky rather than self-correcting, and the fix is a five-line generation token, so it should not be dismissed.

**Fix**

All edits in js/chat.js (then bump nothing by hand — the pre-commit hook owns APP_VERSION/CACHE_VER).

1. Add a generation counter beside the existing state at js/chat.js:38: `let _openConvId = null, _openConv = null, _openSeq = 0;`

2. In `openConversation(convId, preloaded)` (js/chat.js:1697), take a token on entry and re-check after EVERY await. `convId` equality is not sufficient — an A → B → A sequence has the stale continuation matching on convId — so gate on the token:
   - line 1698, first statement: `const myOpen = ++_openSeq;`
   - after the optional conv fetch at 1700: `if (myOpen !== _openSeq) return;` (before `teardownThread()`, so a superseded notification/search deep-link never tears down the thread the user is actually in).
   - rewrite 1733 so nothing is assigned before the check:
     `const readAtMs = await _myReadAtForOpen(convId, conv);`
     `if (myOpen !== _openSeq) return;   // superseded — another conversation opened while this readAt was in flight`
     `_threadOpenReadAtMs = readAtMs;`
     This one line is what prevents 1734-1795 (the shared-state resets, the three `_threadUnsubs.push` calls, `_startPresenceHeader`, and the `_typingExpireTimer`) from ever running for a superseded open, and it also removes the `_initialMarkReadPending` re-arm at 1739 that bypasses the at-bottom gate.
   - replace the weaker guard in the `_refreshUsersCache().then()` callback at 1747 with the token: `if (conv.type === 'dm' && myOpen === _openSeq)`.
   - replace the guard at 1775 with `if (_initialMarkReadPending && myOpen === _openSeq)`.

3. Belt-and-braces inside the listeners, so a stale subscription can never paint even if a future refactor reintroduces the gap. Add as the first line of each of the three snapshot bodies (1759, 1789, 1792): `if (_openConvId !== convId) return;`.

4. Stop the interval clobber (independent of the race — this is a plain single-slot bug):
   - before js/chat.js:1795: `if (_typingExpireTimer) clearInterval(_typingExpireTimer);`
   - in `_startPresenceHeader`, before js/chat.js:2257: `if (_presenceTimer) clearInterval(_presenceTimer);`
   Also give `paint` the same identity guard so a surviving timer cannot write another conversation's presence into the open header — capture `const seq = _openSeq;` in `_startPresenceHeader` and make `paint` start with `if (seq !== _openSeq) return;`.

5. Optional hardening for the sticky-render property: give `_renderThread` (js/chat.js:4926) an early `if (!_openConvId) return;`, and have `loadEarlier` (2205-2211) verify `anchor` belongs to the open conv (capture `const cid = _openConvId;` before the await and bail on mismatch after it) so a cross-conversation `startAfter` cursor can never be issued.

No firestore.rules or index changes are needed — this is entirely client-side lifecycle.

### F32 — Worker-payslip edit rewrites the WPAY ledger amount without a finance_rollup -1/+1 sync — Finance Overview's Total Expenses KPI silently drifts (Reports/P&L unaffected)

`MONEY`

**What is true**

Confirmed by direct reading of the current tree; only the finding's line citations were stale (~200-line drift) and its blast radius was overstated.

What is true: `openPayslipEdit` (js/screens/hr.js:3500-3625) writes the corrected payslip, then at hr.js:3599-3600 does `db.collection('ledger').where('refNumber','==',`WPAY-${ps.id}`).limit(1).get()` followed by a raw `lsnap.docs[0].ref.update({ amount: netPay })` with no rollup compensation — I grepped the whole function for /rollup|_syncRollup|Ledger\./ and got zero hits. That row was posted at hr.js:3424-3437 through `window.Ledger.upsertByRef` with `accountType:'expense', category:'Payroll Expense'`, and upsertByRef seeds the aggregate at js/finance-ledger.js:395-396 (`if (oldRow) _syncRollup(oldRow,-1); if (newRow) _syncRollup(newRow,+1)`), with `refNumber: entry.ref` persisted at finance-ledger.js:213 so the edit's query genuinely matches. `_rollupDelta` (finance-ledger.js:255-272) books the full amount into `finance_rollup.expense`. Finance Overview reads the rollup exclusively — finance.js:2115 `dbCachedGet('finance_rollup', …)`, :2122-2123 the income/expense reduces, :2145-2146 the KPI cards — and its only guard (:2129-2133 `if (!rollups.length)`) is an emptiness probe, not a drift check, so a merely-stale rollup renders as an authoritative figure with no warning. The correct -1/+1 pattern exists in the Type-A sibling in the same file at hr.js:1087-1093.

Reach is real: the edit button (hr.js:3348) is gated on `canAct` (president/owner/manager/finance, hr.js:3318) with NO status condition, unlike the override button beside it, so a 'submitted' payslip — the only status that has a ledger row (posted solely in the `next === 'submitted'` branch) — is editable. firestore.rules:1512 permits the ledger update for exactly those roles, and no Cloud Function reconciles rollups server-side.

Corrections I adopted from the refuters (all three concurred; none refuted): (1) the drifting KPIs are ALL-TIME sums, not "monthly"; (2) "net income shown to the President" is NOT affected — Reports/P&L go through `loadFinStatement` (finance.js:514-535), which scans the ledger live and therefore shows the edited figure. So the real symptom is Finance Overview's Total Income/Total Expenses silently disagreeing with the Ledger and Reports screens by the cumulative sum of every post-submit payslip correction. (3) Persistence is worse than the finding claimed: `financeExecuteDelete` (departments.js:552-575) reads the ledger row immediately before deleting and subtracts its CURRENT amount, so later deleting the payslip subtracts 3,600 from a bucket holding 4,200 and strands the ₱600 permanently with no source row left to trace it to. Repair is president-only and manual (finance-ledger.js:622-624 `rebuildRollups` throws unless `isRealPresident()`, reachable only from the Finance Tools button at finance.js:300).

I downgraded impact from the claimed high to medium: the authoritative money artifacts (the ledger row itself, P&L, break-even, actual pay) are all correct; what breaks is one headline dashboard KPI pair, silently and cumulatively, with an existing one-click president repair.

**Fix**

In js/screens/hr.js, inside `openPayslipEdit`'s save handler, replace the unsynced update at lines 3598-3600 with the same -1/+1 shape its Type-A sibling uses at hr.js:1087-1093:

    const _rollupSync = (window.Ledger && typeof window.Ledger._syncRollup === 'function') ? window.Ledger._syncRollup : null;
    const lsnap = await db.collection('ledger').where('refNumber','==',`WPAY-${ps.id}`).limit(1).get().catch(()=>({docs:[]}));
    if (lsnap.docs.length) {
      const _oldLedgerRow = lsnap.docs[0].data();
      await lsnap.docs[0].ref.update({ amount: netPay });
      if (_rollupSync) {
        await _rollupSync(_oldLedgerRow, -1);
        await _rollupSync({ ..._oldLedgerRow, amount: netPay }, +1);
      }
      if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('ledger'); dbCacheInvalidate('finance_rollup'); }
    }

Notes on shape: the edit does not change `payDate`, so the row's month bucket is stable and a straight -1/+1 on the same `finance_rollup/{month}` doc is correct — no cross-month move needed. `_syncRollup` is already exported (finance-ledger.js:677 `_rollupDelta: _rollupDelta, _syncRollup: _syncRollup`) and never throws, matching the best-effort contract in that file's header, so this cannot break the payslip save. Pass the full old row (not a hand-built stub) so `_rollupDelta`'s category and VAT computation subtract exactly what was added.

Alternative (slightly larger, more uniform): route the correction through `window.Ledger.upsertByRef(`WPAY-${ps.id}`, () => ({ ...same builder as hr.js:3432-3437, amount: netPay }))`, which performs the -1/+1 internally at finance-ledger.js:395-396 — this also keeps the ledger row's description/account in step with the edited payslip. It requires re-resolving the bank account tag, so the minimal `_syncRollup` patch above is the safer change.

Also worth doing while in this file: the delete path in departments.js:552-575 is correct only if the rollup was in sync, so after shipping the fix have the President run Finance Tools → Rebuild rollups (finance.js:300 → `window.runRebuildRollups`) once to clear any drift already accumulated in production. Optional hardening, separate change: make the `needsRollupRebuild` banner (finance.js:2129-2133) more than an emptiness probe — e.g. compare rollup `count` against a ledger count — so silent drift surfaces instead of rendering as an authoritative KPI.

### F33 — Manual Stock In/Out save (js/modules.js moveModal) has no double-submit guard and writes qty + movement row non-atomically — a repeat click double-applies increment(delta); the finding's rules-denial trigger and qtyAfter claims are wrong

`MONEY`

**What is true**

The defect is real but was misdiagnosed on three of its four supporting claims, and the effect lens is right on all three of those.

REFUTED and dropped: (1) The rules-denial trigger cannot happen. firestore.rules:1673-1676 gives inventory_items `allow write: if isAuth() && !isPartner()` and firestore.rules:1678-1682 gives stock_movements `allow create: if isAuth() && !isPartner()` — byte-identical predicates. No user can pass write #1 and fail write #2; a partner is denied at line 292 first and nothing partially commits. (2) "One movement row with no qty change" is structurally impossible — line 292 is awaited before 293. (3) The secondary qtyAfter-drift claim has zero effect: `grep -rn qtyAfter js/` returns only write sites plus the normalizer at js/config.js:764. Nothing reads it — the movement table (js/modules.js:327-337) and the CSV export (js/modules.js:346-350) both omit it, so a stale running balance is invisible everywhere.

The effect lens is also right that offline does not fire the catch (js/firebase-config.js:77 enables persistence; compat writes queue and stay pending rather than reject).

WHY IT STILL STANDS — and it is a different, better-founded defect than the one written up. The offline behaviour the effect lens cites makes the failure MORE likely, not less: offline, the await at line 292 never resolves, so the modal just sits there with no spinner, no error, no close, and a live Save button. The user clicks Save again. Each click queues its own independent `increment(delta)`, and on reconnect BOTH commit — on-hand is double-applied. The same double-fire happens online on a fast double-click inside the 200-500ms round trip. There is no `disabled` guard anywhere on `#mv-save`; the only grep hits for a busy guard in js/modules.js/js/app.js are unrelated.

That omission violates an established convention in this very repo: js/screens/production.js:297/312 disables `dr-save` and re-enables it in the catch; js/departments.js:3300, js/screens/design.js:436 and :546, js/screens/production.js:674 and :745 all carry the literal comment "guard against double-click double-posting". The one handler that moves stock quantity every day was left unguarded.

The non-atomicity is separately real, just with a narrower trigger set than claimed: line 295 reads `document.getElementById('mv-note').value` WITHOUT optional chaining (unlike `mv-project?.` on 294), so a panel teardown while write #1 is in flight throws a TypeError after qty has committed — and the catch writes into an `err` node that is now detached, so the user sees nothing. Same outcome if the tab closes while the queued increment is pending. Result is on-hand moved with no stock_movements row: an audit-log gap, not a wrong balance.

MONEY: real but derived and correctable. inventory_items.qty × unitCost feeds the Stock Value KPI (js/modules.js:118) and the Balance Sheet inventory line via js/bir.js:975-977, called at js/bir.js:1016. A doubled 50-unit receipt at ₱1,200 overstates that line by ₱60,000. It is not a ledger posting and is correctable through the transactional physical-count path (js/screens/production.js:1858-1874), which is why this is medium, not high — the finding's IMPACT: high is overstated.

**Fix**

All edits in `js/modules.js`, function `moveModal` (lines 277-302), modelled on the two shapes this repo already uses: the busy guard at js/screens/production.js:297/312 and the transaction at js/screens/production.js:1349-1379.

1. DOUBLE-SUBMIT GUARD (the high-value half — do this even if nothing else). In the `#mv-save` click handler (js/modules.js:286), after the `qty<=0` early return and before the try: capture `const btn = document.getElementById('mv-save');` then `if (btn.disabled) return; btn.disabled = true;`. Re-enable ONLY in the catch at line 300 (`... err.classList.remove('hidden'); btn.disabled = false;`) — not in a finally, since the success path closes the modal. This is a verbatim copy of js/screens/production.js:297 + :312.

2. HOIST THE DOM READS ABOVE THE FIRST AWAIT. Lines 294-295 read `mv-project` and `mv-note` between the two writes; `mv-note` is not optional-chained, so a torn-down panel throws after qty has already committed. Move both into consts right after `const delta = ...` on line 290:
   `const noteVal = document.getElementById('mv-note')?.value.trim() || '';`
   `const projVal = type==='out' ? (document.getElementById('mv-project')?.value.trim() || '') : '';`
   and reference `noteVal` / `projVal` in the payload.

3. MAKE THE PAIR ATOMIC AND IDEMPOTENT. Mint one stable id when the modal opens (inside `moveModal`, before `openPage`): `const opId = db.collection('stock_movements').doc().id;`. Then replace lines 292-296 with a single `await db.runTransaction(async (tx) => { ... })`:
   - `const itemRef = db.collection('inventory_items').doc(item.id);`
   - `const mvRef = db.collection('stock_movements').doc('MAN_' + opId);`
   - reads first (Firestore requires it): `const mvSnap = await tx.get(mvRef); if (mvSnap.exists) return; const s = await tx.get(itemRef); if (!s.exists) throw new Error('Item no longer exists');`
   - `const live = Number(s.data().qty) || 0;`
   - `tx.update(itemRef, { qty: firebase.firestore.FieldValue.increment(delta), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });`
   - `tx.set(mvRef, window.buildStockMovement({ itemId:item.id, itemName:item.name||'', type, qty, project:projVal, note:noteVal, source:'manual', unitCost:item.unitCost||null, qtyAfter: live + delta }));`
   The `mvSnap.exists` short-circuit plus the fixed `MAN_<opId>` id makes a retry (or a queued duplicate click) a no-op instead of a second increment, and `qtyAfter` now comes from the LIVE doc rather than the 45s-cached `item` (js/modules.js:97). Leave lines 297-299 (`logAudit`, `dbCacheInvalidate`, `closeModal`) after the transaction.

4. SAME FAMILY, SAME BUG, WORSE: js/modules.js:255-263 (the item-edit handler) updates qty and then posts the 'adjust' movement with `.catch(()=>{})` on line 262 — that swallows the failure outright, so a log gap there is silent by construction. Fold that pair into the same runTransaction shape (deterministic id `ADJ_<opId>`), and drop the bare `.catch(()=>{})`. Also add the same `iv-save` disabled guard used in step 1.

No firestore.rules change is needed — both collections already carry the identical `isAuth() && !isPartner()` predicate, and a transaction spanning them passes as one commit. No index change. CACHE_VER/APP_VERSION are handled by the pre-commit hook.

### F34 — computePayRun's double-pay guard fails open: a failed/cold-cache worker_profiles read silently empties the linked-worker exclusion set and computes a wrong monthly run (disburse currently blocked by an unrelated temporary gate)

`MONEY`

**What is true**

The defect is real and verbatim-present. js/departments.js:1775 reads `db.collection('worker_profiles').get().catch(()=>({docs:[]}))` and js/departments.js:1776-1778 derives `linkedUids` from it; the only consumer is the skip at js/departments.js:1791. On any failure the set is empty and the guard whose own comment (js/departments.js:1772-1774) says "Hard-skip both routes into the monthly run so nobody is paid twice" becomes a silent no-op. No downstream check restores it: disbursePayRun replays the frozen `run.lines` (js/departments.js:1926) and never re-derives the exclusion. I confirmed the payroll region is untouched by the uncommitted working-tree diff (that diff is unrelated quote-company registry work).

I followed the EFFECT lens on impact and rejected its "harmless" conclusion. Its factual claims check out: STATUTORY has exactly one year key, 2026, with `verified: false` (js/statutory-tables.js:21), and disbursePayRun hard-returns at the D10 gate (js/departments.js:1888-1897) before the transaction, before salary_history, before any CA mutation — so today ₱0 can move and "tens of thousands disbursed" / "rules-immutable once disbursed" cannot occur as written. But that gate is an explicitly temporary placeholder ("Set verified:true only once an accountant signs off", statutory-tables.js:7) and is not the double-pay guard; the moment it is flipped this fail-open is the only thing standing between a linked worker and two paychecks. A latent money defect gated by a flag designed to be removed is not harmless, so I kept stands=true and downgraded high → medium rather than refuting.

I also adopted both narrowing corrections. (a) Blast radius: js/departments.js:1790 skips `payClass === 'production'` on the line ABOVE, so the fail-open only bites a linked profile whose linked uid is still payClass 'regular' and is not `removed`/`payrollExcluded` — precisely the configuration js/screens/hr.js:1617-1628 documents as real ("A worker_profiles doc can point linkedUid at this uid even while payClass here is still 'regular' … two independent skip reasons"). (b) The finding's citation hr.js:1449-1458 is wrong; hr.js:1617-1628 is the real evidence.

Three of the finding's supporting claims are wrong and I dropped them. (1) "a rules change" is not a viable trigger: firestore.rules:1638 grants the worker_profiles list to isFinanceOrAdmin, a strict superset of the isMoneyAdmin required to create pay_runs (firestore.rules:890), so anyone denied the read is also denied the write and computePayRun throws at the `.set()` — nothing is persisted. (2) `skipped[]` is write-only: `grep skipped js/screens/hr.js` returns only two unrelated hits, so its omission loses no signal that was ever displayed. (3) The erroneous line is not invisible — it renders as a full row with name/base/net in the Verify roster (js/screens/hr.js:1275-1313). Its real cost is that the pay_run doc's own audit record of who was excluded and why is silently falsified.

One correction from the REACH lens materially changes the fix and I adopted it: with Firestore IndexedDB persistence enabled (js/firebase-config.js:77-78), a COLLECTION `get()` while offline resolves from cache rather than rejecting, and on a cold cache resolves EMPTY. Deleting the `.catch` alone therefore does not close the hole — the read must be forced to the server.

Realistic worst case: an office/regular-salaried employee who also has a linked worker_profiles doc gets a full monthly line on top of their weekly payslips; the weaker case (linked login with no payroll doc) produces the base-₱0 negative-net line the payrollExcluded flag was added to stop. Either way the run is wrong, it is reversible by one Compute click before Verify, and no money moves while the statutory gate is closed.

**Fix**

1) js/departments.js — `window.computePayRun`, line 1775. Make the guard's input authoritative instead of fail-open. Replace:

  const wpSnap = await db.collection('worker_profiles').get().catch(()=>({docs:[]}));

with a server-forced read that aborts the whole Compute on failure:

  let wpSnap;
  const _wpErr = 'Cannot compute payroll: the Type-B worker-profile list could not be read, so the double-pay guard cannot be applied. Check your connection and retry.';
  try { wpSnap = await db.collection('worker_profiles').get({ source: 'server' }); }
  catch (e) { throw new Error(_wpErr); }
  if (wpSnap.metadata && wpSnap.metadata.fromCache) throw new Error(_wpErr);

`{ source: 'server' }` is load-bearing, not belt-and-braces: with offline persistence on, the default-source collection get() resolves EMPTY from a cold cache without ever rejecting, so removing the `.catch` by itself leaves the hole open. The `fromCache` assert covers SDK builds that ignore the option. computePayRun is already called inside a try/catch in the hr.js handler (js/screens/hr.js:2333-2338), which surfaces `err.message` as an error toast, so throwing degrades to a visible failure rather than an unhandled rejection.

2) js/departments.js — the `pay_runs` write at lines 1861-1866. Persist the guard's evidence so a run is auditable after the fact: add `wpScanned: wpSnap.size, linkedUidCount: linkedUids.size` to the `.set()` payload alongside the existing `skipped`. Without this there is no way to tell a run computed with a healthy exclusion set from one computed with an empty one.

3) js/screens/hr.js — `loadPayrollTable`, at the run caption (hr.js:1272, the `captionEl.innerHTML` for a frozen run). `runData.skipped` is written on every run and rendered nowhere. Append a one-line summary — e.g. `· N skipped (2 production, 1 linked-worker-profile, 1 removed)` built by counting `runData.skipped` by `reason` — so an exclusion that silently vanished is visible next to the roster it should have shrunk.

4) Companion, separate defect, same shape — js/config.js:631, `fetchUsersWithPayroll`: `db.collection('payroll').get().catch(() => ({ docs: [] }))`. A failed payroll read there merges nothing onto the users docs, so every employee computes at base 0/undefined and the whole run is silently wrong. Same treatment (server source, throw on failure). Worth its own ticket rather than folding into this fix.

### F38 — CI's node --check glob `js/*.js scripts/*.js` never descends into js/screens/ — 30k of 58k JS lines (plus sw.js) have zero syntax signal

**What is true**

REAL, but misdiagnosed as a deploy-gate failure; it is a detection-coverage gap. Confirmed by direct inspection: .github/workflows/ci.yml:19 is `for f in js/*.js scripts/*.js; do node --check "$f" || fail=1; done`. A POSIX glob cannot descend one level, and globstar is not set, so js/screens/ is never visited — `bash -c 'for f in js/*.js scripts/*.js; do echo $f; done' | grep -c screens` returns 0. js/screens/ holds 13 real files loaded as classic `<script defer>` (index.html has exactly 13 such tags, e.g. :496 js/screens/hr.js), so a parse error discards the whole file and every global it defines; js/screens/hr.js:348 window.renderHR and :738 window.renderPayrollHub exist only there, and js/app.js dispatches `case 'HR'` to them. `grep -rn "node --check"` across .github/, scripts/, .githooks/ returns only ci.yml — no other parse gate. The sibling guards know about js/screens but cannot catch a parse break: scripts/ci-invariants.sh:180 only greps names, and scripts/check-ui-wiring.js:47-52 `for (const name of fs.readdirSync(JS_DIR)) if (name.endsWith('.js'))` is non-recursive AND regex-based. I confirmed all 13 screens files currently parse clean, so this is prospective, not a live outage.

Three corrections to the finding, all of which the refuters also flagged and which I independently verified:
1. The severity framing "the gate that exists to prevent exactly this is pointed at the wrong half" is wrong — CI is not a deploy gate. pages-deploy-check.yml polls the legacy branch-based Pages builder, which publishes regardless of Actions status (CLAUDE.md: "No CI gate"). A syntax error in js/app.js, which IS globbed, would reach production too; the covered half just gets a red X within a minute. The true consequence is detection latency, not an extra outage class. That is why I set severity=medium rather than the claimed high.
2. Counts are wrong in both directions: the glob matches 24 files under js/ (35 is the whole loop including 11 under scripts/), and js/screens/ is 30,201 lines vs 27,554 in js/*.js — the uncovered portion is 52% of the JS, larger than the claimed "24k of 40k". Per-file counts are stale (hr.js 5261, dashboards.js 6135, production.js 3207).
3. "Until someone opens the console" is not accurate: js/errlog.js:94 installs window.onerror (loaded at index.html:407, before every screens file) and writes to error_log (:46), which js/screens/dashboards.js surfaces as a 7-day summary. Post-deploy and requires a human to look, so the gap is real — the failure is captured, not silent.

Scope note the finding missed entirely: the same glob also skips sw.js, firebase-messaging-sw.js, and functions/index.js at the repo root — none are syntax-checked either, and a broken sw.js is a delivery-pipeline problem the repo has already been bitten by.

**Fix**

One-line fix in .github/workflows/ci.yml, plus two consistency follow-ons.

1. .github/workflows/ci.yml:15-25 — replace the fixed glob with a recursive file list so future js/<subdir>/ additions are covered automatically, and pull in the root/service-worker/functions files:

      - name: node --check on every JS file
        run: |
          set -e
          fail=0
          while IFS= read -r f; do
            echo "checking $f"
            node --check "$f" || fail=1
          done < <(find js scripts functions -name '*.js' -not -path '*/node_modules/*' -print; ls sw.js firebase-messaging-sw.js 2>/dev/null)
          if [ "$fail" -ne 0 ]; then echo "One or more files failed node --check"; exit 1; fi

  Requires `shell: bash` on the step for process substitution (or pipe into the loop with a `find ... | while read` form). Update the step `name:` too — the current one advertises the wrong scope. If a minimal edit is preferred, `for f in js/*.js js/scree```ns/*.js scripts/*.js; do` at line 19 closes the reported hole but re-opens it the next time a subdirectory appears, so prefer the find form.

2. scripts/check-ui-wiring.js:47-56 — `listSourceFiles()` has the identical blind spot; make it recurse:

  function listSourceFiles() {
    const files = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js')) files.push(p);
      }
    };
    walk(JS_DIR);
    ...
  }

  Note this widens that guard's input set and may surface pre-existing violations in js/screens/ that need allowlisting in the wiring allowlist JSON — do it as its own commit, separate from the ci.yml change.

3. Optional guard-against-regression: scripts/ci-invariants.sh already models the right pattern at lines 26-27 (`find js/screens -maxdepth 1 -name '*.js'`). Add a fourth invariant asserting that every `<script src="...js">` in index.html appears in the syntax job's file list, so a new directory cannot silently fall out of coverage again.

Do not claim this makes CI block bad deploys — it does not. If gating is actually wanted, that is a separate change: switch from the legacy branch-based Pages builder to an actions/deploy-pages workflow with `needs: [syntax, money-math-tests, ...]`.

### F40 — openPage panels keep duplicate ids alive, and there is no shared panel-scoped accessor — document-wide getElementById leaves money controls dead after a clearAll+reopen (design.js Financials/Overview confirmed); the claimed cross-worker payslip corruption is not reachable

**What is true**

The architectural half of F40 is true and I confirmed every structural claim in the current tree: openPage appends each panel to <body> (js/app.js:3809), buries the previous one with `.page-under` but leaves it in the DOM (js/app.js:3799), and defers removal by 300ms (js/app.js:3862); the only guard, `doReplace`, is opt-in (js/app.js:3739-3750). Caller bodyHTML ids are never namespaced (js/app.js:3772). There is no shared panel-scoped accessor anywhere in js/ — I grepped and the only instances are two hand-copied `const $p = (id) => panel.querySelector('#' + id)` in js/screens/tasks.js:1015 and :1149. Two separate in-repo comments document the class as already REPRODUCED in production: tasks.js:1008-1014 ("create task not working" — enable+bind landed on a buried button) and js/screens/design.js:283-295 ("Record Payment saved the money and the ledger leg, then returned a blank window with no payment, no balance and no confirmation").

The "reach" refuter is wrong to call the whole thing unreachable. It only checked the payslip branch and the `{replace:true}` path, and missed the pattern that actually fires: `Overlay.clearAll(); openX(...)` in ONE tick. clearAll (js/config.js:1255) tears every panel down but each `p.remove()` is still 300ms away, so the dying panel is in the document, EARLIER in document order, and wins getElementById — while the freshly opened panel renders synchronously. That pattern is used ~10 times (design.js:358, 653, 752, 912, 943, 1214, 1238; production.js:948; hr.js:3452). I confirmed a live instance design.js already half-fixed: the tab body was scoped to `_pdPanel`, but the tab renderers were not. js/screens/design.js:392 `document.getElementById('proj-payment-btn')` and :512 `document.getElementById('proj-invoice-btn')` both run synchronously inside renderProjFinancials, and `reopen()` at design.js:358 is exactly `Overlay.clearAll(); openProjectDetail(..., 'Financials')` — so after recording a payment, the newly visible Record Payment and Create Billing Invoice buttons get no listener (the dying panel's do) and are dead until the user leaves and re-enters. Same shape at design.js:345 `document.getElementById('proj-edit-btn')` reached via the Cancel/Save handlers at design.js:653 and :752, which reopen on the 'Overview' tab.

The "effect" refuter is right about the headline consequence and I follow it. openPayslipEdit (js/screens/hr.js:3538) binds AND reads through the same document-wide lookup (`num()` at hr.js:3565, the input listeners at 3572, and `document.getElementById('pe-save-btn')` at 3574), so a duplicate stack would hand the Save listener to the same buried panel that supplies the wrong values — the visible panel is inert, nothing is written, ₱0 impact. I also confirmed no reachable stack puts two `pe-*` panels in the DOM: the only two declarers are openPayslipEdit (hr.js:3541-3563) and openPayslipEditPanel (hr.js:4870-4882), and they sit on disjoint drill-in branches (Summary → ps-edit-btn → openPayslipEdit at hr.js:3452 vs Summary → ps-view-btn → renderPayslipPage at hr.js:4763 → openPayslipEditPanel), with no `pe-*` id anywhere in openPayslipHistory's or buildPayslipHTML's markup (I grepped both ranges: zero hits). So "worker B's payslip saved with worker A's rate, hours and deductions, ledger row and cash-advance balance updated to match" is unsupported and should be struck.

One genuinely asymmetric money-screen panel does exist and is worth fixing on its own: openPayslipEditPanel binds scoped (`panel.querySelector('#pe-save-btn')`, hr.js:4922) but reads document-wide (hr.js:4925-4932, `pe-name`/`pe-title`/`pe-dept`/`pe-empid`/`pe-tin`/`pe-sss`/`pe-ph`/`pe-pib`). That is the bind-new/read-old shape that WOULD write a foreign panel's values — today unreachable, and its write whitelist is identity/gov-ID strings only (hr.js:4964-4984), never rate/hours/deductions/ledger/CA.

Three of the finding's own EVIDENCE line numbers are wrong (hr.js:3360 is a template span, 3395 is a bare `};`, 4720-4727 is a print-CSS comment with no DOM lookups) and its DETAIL is truncated mid-sentence, so its list of affected money panels was never delivered. The "78 functions / 1043 lookups" magnitude is plausible but unverified as stated; what I can verify is 131 openPage call sites across 18 files and ~1650 document-wide lookups in non-vendor js/, with scoped access hand-rolled in only 4 files. Net: real defect, correct diagnosis of the mechanism, overstated impact — reachable symptom is dead/inert controls on money screens (including a payment that saves and then leaves a dead UI), plus a latent wrong-record write if any future file reuses an id.

**Fix**

Three tiers, smallest first.

1. Fix the confirmed-live dead controls (zero-risk, `host` is already the scoped tab body):
   - js/screens/design.js:345 — `document.getElementById('proj-edit-btn')` → `host.querySelector('#proj-edit-btn')` inside renderProjOverview.
   - js/screens/design.js:392 — `document.getElementById('proj-payment-btn')` → `host.querySelector('#proj-payment-btn')` inside renderProjFinancials.
   - js/screens/design.js:512 — `document.getElementById('proj-invoice-btn')` → `host.querySelector('#proj-invoice-btn')` (same function).
   Then sweep the rest of design.js's tab renderers (renderProjectDrawings / renderProjectFiles / renderProjectTasks / renderProjActivity) the same way — each receives `host`, and design.js has 77 document-wide lookups and 0 scoped ones.

2. Fix the asymmetric payroll panels:
   - js/screens/hr.js:4925-4932 (openPayslipEditPanel Save handler) — replace the eight `document.getElementById('pe-…')` reads with `panel.querySelector('#pe-…')`. The `panel` const is already in scope (hr.js:4847) and the bind at 4922 already uses it; this removes the only bind-scoped/read-global asymmetry on a money screen.
   - js/screens/hr.js:3538 (openPayslipEdit) — capture the return value (`const panel = openPage(...)`, openPage returns the node) and rewrite `num` at 3565 as `const num = id => parseFloat(panel.querySelector('#'+id)?.value)||0;` (also removes the unguarded `.value` on a possibly-null node), plus 3569 `#pe-net`, the input loop at 3571-3572, and the save bind at 3574.

3. Kill the class, since two independent reproductions and two hand-copied `$p` helpers show folklore is not holding:
   - In js/app.js's openPage, right before `return p`, attach the accessor to the panel itself: `p.$ = (id) => p.querySelector('#' + id);` and document it in the block comment above openPage as the only supported way to reach a panel's own ids. Callers become `const panel = openPage(...)` then `panel.$('pe-sss')`, and sub-renderers that take a `host` use `host.closest('.page-panel')?.$ ?? (id => host.querySelector('#'+id))`.
   - Collapse the two duplicated helpers at js/screens/tasks.js:1015 and :1149 onto `panel.$` so there is one definition, and keep the explanatory comment at tasks.js:1008-1014 as the canonical rationale.
   - Add a cheap guard to .githooks/pre-commit: fail the commit when a diff hunk in a file that contains `openPage(` adds a `document.getElementById(` line. That is the piece the finding correctly says is missing — nothing today stops a new file from reintroducing this.
   Bump CACHE_VER / APP_VERSION per the repo rule (the pre-commit hook handles it).

### F41 — Employee-facing dashboard shows an all-time KPI under the same "Task KPI (70%)" label payroll computes month-scoped — three separate KPI implementations disagree (display-only today, latent pay bug under 'performance' policy)

**What is true**

The core code claim is true and I confirmed every line of it directly. `getKpiScore` (js/screens/dashboards.js:2952) scores an employee's ENTIRE task history (`tasks.filter(done).length / tasks.length`), floors at 0.5 with no tasks, defaults deliverableScore to 0.5, and returns 0.5 on error. `window.computeKpiForMonth` (js/money-core.js:360 — the finding's ":340" is drift) scopes to month M (`if (cm > month) continue`), floors at 1 (`if (inScopeCount === 0) return 1`), and defaults deliverable to 1. The consumer split is real: grep gives exactly three getKpiScore call sites (dashboards.js:2405, dashboards.js:3245, people.js:2607), none of which touch payroll, while payroll (departments.js:1827) and HR's Verify preview (hr.js:1645-1646) use the month-scoped one. The repo itself documents the divergence at hr.js:1609-1611. The dead-code sub-claim is also correct: `where('assignedTo','array-contains',uid).get().catch(()=>where('assignedTo','==',uid).get())` at dashboards.js:2960-2961 (and duplicated at dashboards.js:2401-2402) never fires its catch — array-contains against a scalar field resolves with zero docs, it does not reject — so the dashboard silently drops scalar-assignedTo tasks that payroll's dual-shape filter keeps. So the divergence is both scoping AND population.

The EFFECT lens is right on every point it raises, and I followed it on all of them — it just doesn't reach "not a bug". (1) Employee of the Month is misattributed: `computeEomStandings` (people.js:744) never calls getKpiScore; it inlines a THIRD copy of the all-time ratio at people.js:793 with its own 0.5/0.4/0.1 weights. people.js:2607 is `renderPersonalAnalytics` ("KPI Composite" tile), a different screen. Note this cuts against the finding's framing but makes the underlying problem worse, not better — there are three implementations, not two. (2) Peso impact today is ₱0.00 on the employee's own screen: money-core.js:144 puts kpiScore only in the 'performance' branch, runs default to 'flat' (departments.js:1761), and the employee's projection hardcodes `policy:'flat'` (dashboards.js:2456), so the divergent number renders only as a "×" badge. (3) Post-disburse it self-corrects — dashboards.js:2450-2454 swaps in the frozen `salary_history.kpiScore`.

What survives all three lenses: PRE-disburse — the entire Compute→Verify window, which is exactly when an employee checks and when HR reviews — the employee's Personal Finance screen (dashboards.js:2573) and HR's Edit-Payroll preview (hr.js:1645) show two different numbers for the same employee-month under labels that both read as the payroll KPI. That is a live wrong-number-shown-to-a-user defect and a latent pay defect the day payPolicy flips to 'performance'. I did NOT follow the effect lens to "refuted" because "the wrong number happens to be multiplied by nothing under today's policy" is a coincidence of configuration, not correctness. The effect lens's own escalation is worth keeping: the manager/president worker-profile panel (dashboards.js:3259 `earnedSoFar = net*mult*(daysElapsed/daysInMonth)`) is a peso figure scaled by the all-time factor, and it is wrong under flat policy no matter which KPI function feeds it. Downgraded from high to medium: no posted peso, ledger entry, or pay changes today, and the metric self-heals at disburse.

**Fix**

One source of truth for the KPI number, plus the two population/peso bugs found alongside it.

1. js/screens/dashboards.js — rewrite `getKpiScore(uid, preTasks, preKpiSnap)` (line 2952) to delegate to the money-core function instead of reimplementing it. New signature `getKpiScore(uid, preTasks, preKpiSnap, month)`; body becomes: resolve tasks (see #2), read `kpi_targets/{uid}`, then `return (window.computeKpiForMonth ? window.computeKpiForMonth(tasks, month || window.bizDate().slice(0,7), kpiSnap?.exists ? kpiSnap.data().deliverableScore : undefined, window.taskDoneMonth, window.taskCreatedMonth) : 1);`. Pass the raw 0-100 `deliverableScore`, not a pre-divided value — computeKpiForMonth does its own `/100`. Drop the `catch { return 0.5 }` floor in favour of returning 1, so the no-data floor matches payroll's `inScopeCount === 0 → 1`. Note money-core.js is loaded before dashboards.js, but keep the `window.computeKpiForMonth ?` guard consistent with hr.js:1645.

2. Fix the dead scalar fallback in BOTH copies — dashboards.js:2960-2961 (inside getKpiScore) and dashboards.js:2401-2402 (renderPersonalFinance's own Promise.all, which also feeds `taskPct` at :2437). Replace the `.catch()` chain with either the union of two real queries (`Promise.all([...array-contains..., ...where('assignedTo','==',uid)...])` merged by doc id) or, matching hr.js:1642-1643 exactly, `db.collection('tasks').get()` then `.filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(uid) : t.assignedTo === uid)`. firestore.rules:`match /tasks/{taskId}` allows full read for every non-partner, so the full-fetch form is permitted for all payroll-eligible users; keep the array-contains-only path for partners (the rule restricts them to `request.auth.uid in resource.data.get('assignedTo', [])`, and partners are excluded from payroll anyway).

3. js/screens/dashboards.js:3245 + :3259 — pass the month into `getKpiScore(uid, undefined, undefined, month)` in `renderWorkerProfileTab`, and replace `const earnedSoFar = net*mult*(daysElapsed/daysInMonth)` with the same `window.computePayLine({...u, id: uid}, { month, policy: 'flat', kpiScore: kpi, attScore: att, caPlan: [], caBalance })` → `netBeforeCA * (daysElapsed/daysInMonth)` shape renderPersonalFinance already uses at :2456-2461. This is the only place an all-time factor multiplies pesos.

4. js/screens/people.js:793 — in `computeEomStandings`, replace the inline `const taskScore = mine.length ? Math.min(1, doneTasks / mine.length) : 0.5;` with the month-scoped task term, e.g. reuse hr.js's `_kpiMonthBreakdown`-style scoping or call `window.computeKpiForMonth(mine, monthStr, undefined, window.taskDoneMonth, window.taskCreatedMonth)` and back out the 0.7 task weight — EOTM is explicitly a per-month award (it already scopes attendance to `monthStart..rangeEndStr` at :783-785) yet scores tasks all-time. `mine` already uses the dual-shape `isAssigned`, so no query change is needed here.

5. Labelling, if #1 is deferred: dashboards.js:2572 renders `Task KPI (70%)` for a value that is not payroll's Task KPI pre-disburse. Either relabel to "Projected (live estimate)" or gate the row on `isFinalMonth`.

No firestore.rules or index change is needed. Bump is automatic via the pre-commit hook (CACHE_VER derives from APP_VERSION).

### F42 — Sales' outer chip bar binds the inner sub-nav's chips too: on a Partner/Quotes/Files deep-link, clicking an inner chip fires a second handler that de-highlights the outer bar, rewrites the subroute, and (on Partner) replaces the partner view with a Sales view

**What is true**

REAL, and I confirmed every load-bearing line myself. js/screens/sales.js:129 calls `loadSalesContent(...)` WITHOUT await, and its 'Quotes' (163-177), 'Partner' (179-186) and 'Files' (188-197) branches reach `salesSubNav` with no preceding await, so `content.innerHTML` at sales.js:140-143 paints inner `class="chip-tab"` buttons synchronously inside `#sales-content` (a descendant of `c` = `#page-content`). One line later, sales.js:130 runs `window.bindChipTabs(c, ...)`, and bindChipTabs (js/config.js:1158-1167) does an unfiltered `scope.querySelectorAll('.chip-tab')` — there is exactly one definition of it (confirmed by grep) and no nesting guard. So each inner chip gets a SECOND listener that strips `.active` off every chip in the container (including the outer bar) and calls `setSubroute(innerKey)` + `loadSalesContent(innerKey)`. salesSubNav's own comment at sales.js:133-135 ("Binds ONLY its own buttons … not the outer Sales chip bar") is true only in the direction it describes.

Reach is genuine and unprivileged; I traced it in the current tree. The defect requires Sales to be ENTERED with the subtab already resolved to Quotes/Partner/Files, which happens via: (a) the quote-approved push link — js/app.js:2409 `case 'bk-quotations': window.renderSales?.(currentUser, currentRole, 'Quotes')`; (b) Back — popstate at js/app.js:4012 replays `st.subtab` into navigateTo, which sets `window.currentSubtab` (js/app.js:2344) that sales.js:102 reads via `initialSubtab`; (c) a `#/dept/Sales/Partner` hash deep-link or refresh — js/app.js:191 `{ const r = parseHash(); navigateTo(r.page, { subtab: r.subtab, replace: true }); }`, with the hash written by setSubroute itself (js/config.js:1883-1886). The file is live (index.html:476, sw.js:60) and salesTabs (sales.js:106) is unfiltered by role.

I am DOWNGRADING it from high to medium, and correcting two overstatements in the CLAIMED CONSEQUENCE — the code and effect lenses both caught these and I confirmed them:
1. On the Quotes tab, `loadSalesContent`'s switch has no 'Records' or 'Quick Estimate' case, so the spurious second handler is a content no-op there. The only damage is the outer bar losing its `.active` highlight plus a bogus subroute. And 'Quick Estimate' is aliased back to 'Quotes' at sales.js:108, so only 'Records' is neither aliased nor in salesTabs and falls back to 'Clients' (sales.js:111) on reload. "Rewrites the route to a subtab that no longer exists" is true for Records only.
2. On the Partner tab the wrong-view swap is real but not silent-and-mislabeled: the 🤝 Brilliant Steel banner (sales.js:181) disappears and the sub-nav visibly relabels to "Work Plans | Proposals". It is a wrong-tab navigation, not a mislabeled document set. Also, the finding names only the Partner "Files" chip — the Partner "Quotes" chip has the identical defect (ends on BK quote records instead of the partner's quotes).
Additional narrowing I confirmed: sales.js:130 is the only whole-container bind in the file (1192/1633/1634 are correctly scoped to `.bkq-view`/`.aec-*-tabs`), and re-painting `#sales-content` destroys the double-bound nodes, so the bug is one-shot per renderSales — clicking the outer "Partner" chip afterwards restores correct behaviour. No money is touched, nothing is written, and no data the user cannot already see is exposed. Medium, not high.

**Fix**

Primary fix — scope the outer bind to the outer bar, in /Users/neilbarro/Library/CloudStorage/OneDrive-Personal/BARRO INDUSTRIES copy/Operation Systems Development/js/screens/sales.js, inside window.renderSales:
- Line 125: give the outer bar a class via the existing opts arg — `${window.chipTabs(salesTabs.map(s=>({key:s,label:s})), subtab, { cls:'sales-tabs' })}` (chipTabs already supports opts.cls at js/config.js:1140/1153).
- Line 130: bind that element instead of the whole container — `window.bindChipTabs(c.querySelector('.sales-tabs'), (key) => { window.setSubroute(key); loadSalesContent(currentUser, currentRole, key); });`
Because bindChipTabs then queries inside the bar element itself, the nested `.sales-subnav` chips are out of scope. This is the pattern already used correctly at js/screens/govit.js:132 (`c.querySelector('.gov-tabs')`) and js/app.js:2909 (`.files-tabs`). It also removes the bogus `setSubroute('Records')` route corruption as a side effect.

Recommended hardening — make the shared helper nesting-safe in js/config.js, window.bindChipTabs (1158-1167): skip chips that belong to a nested bar, e.g. resolve the intended bar once (`var bar = scope.classList.contains('chip-tabs') ? scope : scope.querySelector('.chip-tabs');`) and iterate `bar.querySelectorAll('.chip-tab')`, or keep the current query but filter with `if (btn.closest('.chip-tabs') !== bar) return;`, and use `bar` (not `scope`) for the `.active` strip. Before shipping this, re-check the callers that pass a whole container and might legitimately expect multiple bars: js/departments.js:960, js/screens/crm.js:61, js/screens/govit.js:196, js/screens/production.js:1111 and 2048, js/screens/dashboards.js:3556 — each of these has the same latent collision if any of its sub-views paints `.chip-tab` markup synchronously.

Optional cleanup — salesSubNav (sales.js:136-153) could give its bar a distinct class name for its buttons (e.g. `.subchip`) so the two systems can never collide by selector, but that is redundant once the bind is scoped.

No firestore.rules or index change is needed. Version/CACHE_VER is auto-bumped by the pre-commit hook; do not hand-edit.

### F43 — Three screens test raw status==='accepted' instead of window.isQuoteWon, so every quote converted to a Sales Order (status flips to 'won') drops out — the Analytics ledger-sparse revenue fallback can report ₱0 for a period with real won business

**What is true**

The finding's headline is wrong but its underlying consistency defect is real. All three lenses correctly refuted the load-bearing premise "No write path in the app ever sets status:'accepted'" — I confirmed it myself at functions/index.js:1455-1461, where the deployed respondToQuote callable writes `status: internalStatus` ('accepted' on accept) onto the internal quote doc, with `coll` allowlisted to bs_quotes/bk_quotes at 1446; it is reachable one tap away via the unconditional Share button (js/screens/sales.js:1074, statuses at 2167) → q/index.html:433. So "can never be true" and "permanently ₱0" are false, and I follow the refuters on that. What none of the refutations dissolve is the defect in the opposite direction, which they each independently re-derived as the correct, narrower version: js/departments.js:3016 writes `update({ salesOrderId:ref.id, projectId:proj.id, status:'won' })` when a quote becomes a Sales Order, and js/config.js:712 makes `isQuoteWon = salesOrderId || status==='won' || status==='accepted'` the canonical test. The three sites bypass it and match only the 'accepted' string, so a quote falls OUT of the count the moment it is converted, and quotes closed internally (never share-linked) never enter. The material consequence is at js/screens/dashboards.js:4628 `revP = ledInP || wonQuotesP` and :4695 `wonQuotesMonth` — the fallback that exists precisely for months where the ledger is sparse counts only client-accepted-but-not-yet-ordered quotes, so a period whose wins all went through the normal Sales Order flow reports ₱0 revenue. The BK "Accepted"/"Accepted Value" cards (sales.js:1036-1037 → 1085-1086) and the BS "Accepted / Filed" chip (sales.js:1234) are cosmetic under-counts by comparison: that row is a funnel (Total / Value / Accepted / Sent / Drafts) and won quotes already badge separately at sales.js:1069 via `q.salesOrderId?'won':...`. Impact drops from "two headline numbers are dead" to "a reporting under-count plus a fourth definition of won"; severity high → medium, carried by the Analytics fallback alone. Note the finding's line numbers have drifted in this live tree: the 'won' write is departments.js:3016 (not 2894), the canonical use is departments.js:3682 (not 3552), Analytics is dashboards.js:4628/4695/4716 (not 4665/4732/4753).

**Fix**

Route all four sites through the existing canonical helper `window.isQuoteWon` (js/config.js:712) instead of raw status strings. (1) js/screens/dashboards.js:4628 in `buildMetricsSync` — change `chainAllQuotes.filter(q=>q.status==='accepted'&&finPeriodMatch(...))` to `chainAllQuotes.filter(q=>window.isQuoteWon(q)&&finPeriodMatch(ymOf(q.createdAt),anPeriod))`; this is the one that actually moves a peso number, since it feeds `revP = ledInP || wonQuotesP`. (2) js/screens/dashboards.js:4695 `wonQuotesMonth` — same substitution (`window.isQuoteWon(q)&&ymOf(q.createdAt)===ym`), so `revPrev` at :4697 stays on the same denominator as revMTD. (3) js/screens/dashboards.js:4716 top-clients fallback — same substitution; also update the two comments at :4694 and :4713 that say "accepted quotes" to "won quotes". (4) js/screens/sales.js:1036 in the BK records renderer — replace `const accepted = activeQuotes.filter(q=>q.status==='accepted')` with `activeQuotes.filter(window.isQuoteWon)` and relabel the two stat cards at sales.js:1085-1086 from "Accepted"/"Accepted Value" to "Won"/"Won Value" so the card no longer collides in meaning with the per-card `won` badge at sales.js:1069; if the funnel semantics ("accepted but not yet ordered") are wanted instead, keep the filter but rename the cards to "Awaiting SO" and add a separate Won card — do not leave both reading "Accepted". (5) js/screens/sales.js:1234 — `['accepted','filed','approved'].includes(q.status)` conflates a won state with two open states; split into `window.isQuoteWon(q)` for the won count and the filed/approved test for the pipeline count, and relabel the sales.js:1285 card accordingly. Because `window.isQuoteWon` short-circuits on `salesOrderId`, quotes carrying both `salesOrderId` and a stale status are counted once, matching js/departments.js:3682 and js/config.js:883. No Firestore rules, index, or schema change is required — these are all client-side reads over already-fetched rows. Since only .js files change, the pre-commit hook handles APP_VERSION/CACHE_VER; no manual sw.js edit.

### F44 — President's Command Center "overdue 90+d" A/R figure ages from project createdAt instead of the invoice due date, so it over-flags current invoices and contradicts window.arAging on the same data

**What is true**

Real and confirmed by direct reading. js/screens/dashboards.js:1019-1022 (inside renderPresidentDashboard) computes `const arOverdue = _openAR.filter(p=>_dS(p.createdAt)>90).reduce(...)` — pure project age — and feeds it to the red KPI card at :1100/:1104 (`${arOverdue>0?...₱... overdue 90+d...}`). The canonical engine js/config.js:905-926 anchors on the earliest `invoices[].due` and only falls back to `createdAt` when no invoice has a due date; the two other A/R consumers use it (dashboards.js:1458 Finance Dashboard, dashboards.js:4648 Analytics — the finding cited 4685, a 37-line drift, immaterial). Same data on both sides: projList comes from `window.Projects.listAll()` (dashboards.js:962) and departments.js:72 normalizes `invoices: d.invoices || []` onto every project, so the due dates the inline rule ignores are right there. Reach is confirmed: navigateTo('dashboard') → renderDashboard() → isPresident() → renderPresidentDashboard(), no flag or gate; firestore.rules grants the president read on job_projects/projects; `inv.due` is a real captured field (production.js:1022, design.js:532).

Two corrections to the finding. (1) The claimed inverse is false and must be dropped. Because an invoice's due date is on or after the project's creation date, days-since-created >= days-since-due, so the createdAt rule strictly OVER-counts; a 60-day-old project 45 days past due lands in arAging's d3160 bucket, not d90, so both engines agree it is not a 90+ item. There are no false negatives — the harm is one-directional over-flagging. The theoretical `_dS`-returns-0 path (non-Timestamp createdAt) is also inert: project createdAt is always `FieldValue.serverTimestamp()` (production.js:479, design.js:202/893/934), and a project with no createdAt at all yields anchor=null → d=0 → 'cur' in arAging too, so both agree. (2) Impact is display-only, so "high" is overstated. The headline `arOutstanding` (:1021) is correct; only the red state and the sub-line are wrong. No money moves, no ledger or invoice changes, and the divergence only materializes when an open 90+-day-old project carries an invoice with a non-blank `due` (the modal's date input has no default, so blank-due invoices fall back to createdAt and both engines agree). Also note the drill-through target's per-client `oldest` rollup (dashboards.js:1463) is deliberately project-age based and commented as a separate feature — the contradiction is specifically against the aging buckets at :1458 and the Analytics Receivables Aging card. Medium: it is a wrong delinquency signal on the owner's home screen that the app's own canonical engine disagrees with, but it is a KPI display defect, not a money or access defect.

**Fix**

In js/screens/dashboards.js, inside renderPresidentDashboard, replace the inline aging rule at lines 1019-1022 with a call to the canonical engine (window.arAging is defined in js/config.js, which loads before dashboards.js per index.html:408, so it is always available; keep a defensive fallback anyway):

  const _openAR = (projList||[]).filter(p=>(p.arBalance||0)>0 && !['paid','cancelled','lost'].includes(String(p.stage||'').toLowerCase()));
  const _arAge = (typeof window.arAging === 'function') ? window.arAging(_openAR) : null;
  const arOutstanding = _arAge ? _arAge.total : _openAR.reduce((s,p)=>s+(p.arBalance||0),0);
  const arOverdue = _arAge ? _arAge.d90 : 0;

Keep the stage filter (arAging does not exclude paid/cancelled/lost stages — it only skips arBalance<=0 — so pass the already-filtered _openAR, not projList). Delete the now-unused `_dS` helper on line 1019 (grep confirms line 1022 is its only use inside renderPresidentDashboard; do not touch the separate `_daysSince` used by the Finance Dashboard per-client rollup at dashboards.js:1463, which is an intentional project-age metric). Render sites at dashboards.js:1100 and :1104 need no change — `arOverdue` keeps the same meaning and now matches the Analytics "90+ d" bucket exactly. No Firestore rules, indexes, or data changes are needed; bump per the repo's version/CACHE_VER workflow (pre-commit hook handles it).

### F46 — President dashboard's "Monthly Payroll" KPI sums all users unfiltered — counts Type-B production workers' WEEKLY rate as monthly and includes external partners (reporting-only; no pay is affected)

**What is true**

Confirmed at the source, not inherited from the refuters. js/screens/dashboards.js:1007 is exactly `const payrollBurn = users.reduce((s,u)=>(s+(u.salary||0)+(u.allowance||0)-(u.deductions||0)),0);` over the full unfiltered `users` array built at :965, and it feeds a card labelled "Monthly Payroll" at :1091-1092. The data really is populated: dbCachedGet force-swaps the 'users' key to window.fetchUsersWithPayroll (js/config.js:657-659), which merges payroll/{uid} over each user doc (config.js:629-640) — and payroll/{uid} is exactly where BOTH `salary` and `payClass` are written (js/screens/hr.js:1868-1870), so the very field needed to filter is already present on the objects being summed. hr.js:1686 renders that same `salary` field as `${_payClass==='production'?'Weekly Rate':'Base Salary'}` (option text at hr.js:1666-1667: "Type B — Production, weekly"), so for Type-B staff the summed figure is a weekly rate. The payroll hub applies two exclusions the dashboard does not — hr.js:849-855 `isExternalPartner` (role 'partner', title "Partner", or Brilliant-Steel-only membership) and hr.js:858-860 `allStaff.filter(u=>u.payClass!=='production')` with the comment "paid WEEKLY via Payroll → Type B, NOT in the monthly run". Reachable unconditionally: dashboards.js:874-876 routes the president to renderPresidentDashboard on the default screen, and firestore.rules:815 + :22 (isFinanceOrAdmin includes 'president') GRANT the unfiltered payroll read, so this is a real non-zero wrong number, not a permission-denied zero. Same naive formula also drives the Team & Payroll table (dashboards.js:5286, 5293-5294) and its CSV (5310-5318), gated to president/manager at :5248.

No lens refuted it and neither did I. Corrections to the finding: (1) line numbers drifted — hr.js:797-809 is now 849-861, hr.js:1516 is now 1686, dashboards.js:5321-5354 is now 5286/5293-5294/5310-5318. (2) The finding's 5-user repro (₱77,600 vs ₱76,266) is unverifiable from source AND is self-undermining — there the partner overstatement nearly cancels the production understatement, leaving a ₱1,333 gap. The real magnitude scales with production headcount (e.g. 20 workers at ₱6,000/wk understates by ~₱360k/month). (3) The Team table/CSV columns are labelled plain "Base"/"Net", so the defect there is unannounced weekly/monthly unit mixing plus partner inclusion, not an explicit false "monthly" claim. (4) "Raise decisions made off this number are all wrong" is behavioural inference — payrollBurn is referenced at exactly two lines and feeds no computation, ledger, or pay run. Severity lowered from the claimed high to medium: no incorrect payment can result (the actual pay run in hr.js filters correctly), the harm is a wrong headline figure on the owner's default screen with no drill-down (unlike the Net Income and A/R cards at :1094/:1100, this card has no onclick) plus a unit-mixed CSV.

**Fix**

Extract the payroll-population rule once and reuse it, since it is already duplicated at js/screens/hr.js:849-860 and js/departments.js:1764-1770.

1) In js/money-core.js (loaded before dashboards.js/hr.js), add:
   window.isExternalPartner = (u) => { if (u.role === 'partner') return true; if (typeof u.title === 'string' && u.title.trim().toLowerCase() === 'partner') return true; const depts = Array.isArray(u.departments) ? u.departments : (u.department ? [u.department] : []); return depts.length === 1 && depts[0] === 'Brilliant Steel'; };
   window.monthlyPayrollStaff = (users) => (users||[]).filter(u => !window.isExternalPartner(u) && u.payClass !== 'production');
   window.netPayOf = (u) => (u.salary||0)+(u.allowance||0)-(u.deductions||0);
   (Optionally window.weeklyToMonthly = (w) => w*52/12 for the Type-B rollup below.)

2) js/screens/dashboards.js:1007 — replace the reduce with:
   const monthlyStaff = window.monthlyPayrollStaff(users);
   const payrollBurn = monthlyStaff.reduce((s,u)=>s+window.netPayOf(u),0);
   const prodStaff = users.filter(u=>!window.isExternalPartner(u) && u.payClass==='production');
   const prodMonthlyEquiv = prodStaff.reduce((s,u)=>s+window.netPayOf(u),0)*52/12;
   Then at :1089-1093 either (a) keep the card as monthly Type-A only and add a kpi-sub line — `<div class="kpi-sub">+₱${formatNum(prodMonthlyEquiv)} Type-B weekly equiv · ${prodStaff.length} production</div>` — or (b) show payrollBurn + prodMonthlyEquiv as a true total wage bill with the sub line breaking out the two components. Either way add `style="cursor:pointer" onclick="navigateTo('dept:Finance')"` (or straight to the payroll hub) so the KPI has the same drill-down as the Net Income / A/R cards beside it.

3) js/screens/dashboards.js renderTeam (5286-5294, 5310-5318) — this table is an accounts roster, so do not filter rows; instead disambiguate units. Add a "Pay Type" column derived from `u.payClass` ("Monthly" / "Weekly (Type B)" / "Partner — not payroll" when isExternalPartner), label the money columns "Base (per period)"/"Net (per period)", and add the same `payType` key to the exportCSV column list at :5310-5318 so an accountant receiving the CSV can tell weekly rows from monthly ones.

4) Refactor hr.js:849-860 and departments.js:1764-1770 to call the shared window.isExternalPartner instead of their local copies, so the rule has one definition.

5) Bump window.APP_VERSION handling as usual (the pre-commit hook does this) — no rules or index changes are needed; payClass is already merged into the dashboard's `users` objects by fetchUsersWithPayroll.

### F48 — Unscoped document.getElementById inside openPage panels binds to a same-id twin that is still in the DOM, leaving the visible control dead — deterministic on Design's Drawing Detail, a sub-300ms reopen race at the cited money forms; nothing is written wrong

**What is true**

The defect class is real and still live; the claimed consequence is not. I verified the mechanism myself: js/app.js openPage appends a new panel per call, buries the previous one alive as .page-under, and its teardown ends `setTimeout(() => { if (p.isConnected) p.remove(); }, 300)` — so a torn-down panel keeps its ids for 300ms. Every cited call site exists verbatim (js/screens/dashboards.js:5350/5444/5552 bind save-emp-btn / cw-save-btn / save-eu-btn globally; js/screens/production.js:857 binds pb-save globally while :917 enables it via `panel.querySelector('#pb-save')` — the enabled-but-unbound worst case, with an in-file comment naming the exact hazard; js/screens/design.js:415/653/912/1153/1214 likewise). The CODE lens is right that the code says what the finding says.

Where the finding is WRONG (I follow the EFFECT refuter here, and confirmed it by reading the handlers): there is no silent unrecorded raise. In js/screens/dashboards.js:5552-5570 the users update, the payroll/{uid} set, window.logAudit, and the `closeModal(); renderTeam()` that always accompanies a real save all live inside the one handler on the unbound button — so a dead button means zero writes, zero audit rows, and the panel visibly STAYS OPEN with the typed values in it. Same at production.js (the whole Ledger.post/projectSync block, :906, is inside the dead handler). No wrong peso amount, no partial post, no falsified audit entry is reachable through this class; and I checked that every cited id (pb-save, save-eu-btn, iv-save, …) is unique app-wide, so the only twin is a second instance of the SAME panel — which is always the outgoing, off-screen one. So: money=false. The finding's headline is also stale — commit 2be702b already spot-fixed four sites of this class (design.js openProjectDetail, production.js openJobProjectDetail, hr.js Edit Payroll), so "fixed only in tasks.js" is untrue.

Where the finding is UNDERSTATED, and why I still rate this medium rather than low: the REACH refuter narrowed the trigger to a human sub-300ms re-tap, which is correct for the sites the finding actually lists — but that is not the worst instance of the class. js/screens/design.js:1032-1036 `reopenDrawing()` does `Overlay.clearAll(); openProjectDetail(...); openDrawingDetail(...)` in ONE tick, and Overlay.clearAll (js/config.js:1255) runs each page teardown, which defers removal by that same 300ms. So the old Drawing Detail node is guaranteed to still be in the document, earlier in tree order, when openDrawingDetail's `document.getElementById('dwg-back-btn'|'dwg-rev-btn'|'dwg-edit-btn')` (js/screens/design.js:1020-1022) runs. That is 100% reproducible, not a race: after any drawing status change, revision save, or drawing edit save, the reconstructed Drawing Detail comes back with Back, "+ New Revision" and "Edit" permanently dead for that panel instance. (The sibling `.dwg-trans-btn` binds survive only because they use querySelectorAll; hr.js:3397 payslip rows are safe for the same reason.) Also note css/styles.css:2307-2327 promoted `transition:none` to the base .page-panel rule, so the closing panel leaves the screen in the same frame — the underlying list is instantly tappable while the id-carrying corpse lingers, which is what makes the "race" variant physically reachable at all.

Net: a real, reachable dead-control / silent-no-op defect with one deterministic instance, no data or money integrity exposure, no security dimension.

**Fix**

Two edits; do (A) first, it is the deterministic one, then (B) which retires the whole class.

(A) js/screens/design.js — openDrawingDetail (function at :976, binds at :1020-1023). Capture the panel and scope the three getElementById calls, since reopenDrawing() guarantees a twin:
    const dwgPanel = openPage(`${drawingTypeIcon(d.type)} …`, …);
    const $d = (id) => dwgPanel.querySelector('#' + id);
    $d('dwg-back-btn').addEventListener(…); $d('dwg-rev-btn')?.addEventListener(…); $d('dwg-edit-btn')?.addEventListener(…);
    dwgPanel.querySelectorAll('.dwg-trans-btn').forEach(…)   // also scope this, so the dying twin stops collecting handlers.

(B) js/app.js — openPage's teardown (the line `setTimeout(() => { if (p.isConnected) p.remove(); }, 300);`). Replace with a synchronous `p.remove();`. The 300ms existed to let the exit transition finish, but css/styles.css:2307-2327 promoted `transition:none` onto the base `.page-panel` rule in v14.0.68 (rest state stays translateX(100%)), so a closing panel is off-screen in the frame `.open` is dropped and nothing is animating — the delay now only keeps a duplicate-id corpse in the document. This kills the dying-twin variant everywhere at once, including (A). Both liveness guards get stricter, not looser, and keep working: tasks.js:548 pageStillLive (isConnected && !_fillAbandoned) and design.js:119 pageStillOpen (isConnected && _pageStack membership). Verify one stacked Back and one Overlay.clearAll()-reopen path visually after the change (the reveal of `newTop` and its _scrollMemo restore are untouched — they act on the panel underneath, not on `p`).

(C) Per-site hygiene, still worth doing because (B) does not cover a panel opened over an identical BURIED (.page-under) panel. Extend the tasks.js:1013 pattern — `const $p = (id) => panel.querySelector('#' + id);` — to every openPage call site that looks its own ids up globally:
  • js/screens/production.js: openProjectBillingModal (panel handle already at :799 — convert the binds at :854-857 and every read in the handler: pb-err, pb-amount, pb-vat, pb-type, pb-method, pb-ref, pb-bankacct, pb-rec, pb-net, pb-vatamt; this site is the worst shape today because :917 already enables scoped while :857 binds global), openJobBillingInvoiceModal (jinv-*, ~:936-1014), the production-order panel (po-*, ~:1448-1597), Record Purchase / Cash Disbursement (rec-*, ~:2867-2953).
  • js/screens/design.js: payPanel (:402), pePanel (:648), dwPanel (:910), dePanel (:1151), ptPanel (:1212) — all already hold the panel handle and use it only for `.page-panel-body`; route the id lookups through it too.
  • js/screens/dashboards.js: openAddEmployeeModal (:5331), openCreateWorkerModal (:5383), openEditEmployeeModal (:5529) currently DISCARD openPage's return value — capture it, then scope all emp-* / cw-* / eu-* lookups.
  • js/modules.js (~:236, iv-*) and js/departments.js (~:3551, save-client-btn) likewise.
Bump nothing by hand — the pre-commit hook handles APP_VERSION/CACHE_VER.

### F53 — Grading queue: manager's "Open & Score" button opens a panel with no score input, and 'done' tasks can never be scored by anyone (queue count never drains)

**What is true**

The code facts are exactly as cited (both the "code" and "reach" lenses check out against the working tree), but the "effect" lens is right that the claimed consequence is wrong, and I found one more thing all three missed.

CONFIRMED, defect 1 (mislabeled control): approvals.js:121 `_showGrading = (_role==='president'||_role==='manager')` puts the Grading chip + live count in front of managers (config.js:498/565 place Approvals in the admin nav; app.js:2399 has no role guard; firestore.rules permits managers to read tasks and kpi_evals, so the queue really populates). Inside the tab the task CTA at approvals.js:777 is ungated and calls `openTaskDetail(id, currentUser, _role)` (:783), but tasks.js:552 declares `openTaskDetail(taskId, currentUser, currentRole)` — the param shadows the global — so the score box at tasks.js:736 (`currentRole==='president'&&SCORE_STATUSES.includes(t.status)`) never renders for a manager. tasks.js:739/741 are the only score-input sinks in js/, so there is no alternate path. Real, but it is a mislabeled button, not a lockout: the panel it opens is fully functional for a manager (isAdmin at tasks.js:647 includes 'manager' → status select, edit, reassign, follow-ups).

CONFIRMED, defect 2 (status-set mismatch — the more damaging half): approvals.js:178/727 query `status in ['approved','completed','done']`; tasks.js:98 `SCORE_STATUSES = ['approved','on-hold','archived']`. 'done' is a first-class, selectable terminal status (tasks.js:78, written raw at :818-822), so every task that ends in 'done' enters the queue and can never be scored — by the President either — without first flipping its status. The Grading badge therefore grows monotonically and cannot reach zero in normal operation. ('completed' has no writer in js/ for tasks — only partner_deals — so the stuck bucket is 'done' plus legacy docs.)

REFUTED, and I follow the effect lens: the claimed KPI/pay consequence is false. The money-bearing payroll KPI is `window.computeKpiForMonth` (money-core.js:360, used by departments.js:1827 and hr.js:1645) and it never touches presidentScore/kpi_evals; its done-detector (config.js:54 `DONE_ST_LOCAL=['done','approved','archived']`) already counts 'done'. And `presidentGradeFromTasks` (tasks.js:977-980) is a mean over already-scored tasks, so an unscorable task is absent from numerator AND denominator — nothing is deflated. Its only consumers are display: dashboards.js:2247/2426, people.js:796-800 (weight 0.1, defaults 0.5 when absent). Peso impact PHP 0.00; no security dimension.

ALSO REFUTED — the finding's headline ("literally cannot grade anything") is false, and no lens caught this: a manager already has a working KPI-grade path at dashboards.js:2181 `const pres = (isPresident() || currentRole === 'manager')`, whose `.grade-emp-btn` (2251) writes `presidentGrade` at 2323-2327. So approvals.js:746 `canGrade = (_role==='president')` is not a policy boundary — it contradicts both dashboards.js and firestore.rules (:738 comment "Only president/manager grade KPIs", isSeniorAdmin at :30; tasks update allowed to isFinanceOrAdmin at :512). The president-only UI gate is the outlier, not the intent.

Net: real but overstated — a UI-consistency defect plus a genuine unscorable-status bug, no money and no data-exposure.

**Fix**

Three edits, all client-side; no rules change needed (rules already permit managers).

1. js/screens/tasks.js:98 — make the gradable set match the queue. Replace `const SCORE_STATUSES = ['approved','on-hold','archived'];` with a single shared source, e.g. `const SCORE_STATUSES = ['approved','done','completed','on-hold','archived']; window.SCORE_STATUSES = SCORE_STATUSES;` and have approvals.js use it for its two queries instead of the hardcoded literal at :178 and :727 (Firestore `in` caps at 10 values, so this list is fine). Dropping 'completed' from the queries is optional cleanup — nothing in js/ writes it for tasks.

2. js/screens/tasks.js:736 — replace the `currentRole==='president'` gate on the President Score block with a shared predicate matching approvals' audience and firestore.rules, e.g. add near the top of tasks.js `function canScoreTask(role){ return role==='president'||role==='manager'; }` and use `${canScoreTask(currentRole)&&SCORE_STATUSES.includes(t.status)?...}`. Relabel the section header from "President Score" to "Performance Score" so the copy matches. (No change needed at tasks.js:552/:962 — the save handler already writes only when the block rendered, and rules allow the write.)

3. js/screens/approvals.js:746 — change `const canGrade = (_role === 'president');` to `const canGrade = _showGrading;` so the KPI Grade button renders for managers, matching dashboards.js:2181 and firestore.rules isSeniorAdmin.

If Neil prefers scoring to stay President-only instead, do the mirror-image fix: keep tasks.js:736 as-is and change approvals.js:121 to `_showGrading = (_role === 'president')` so the chip, the count, and the "Open & Score" button all disappear for managers — but that also means reverting the manager path in dashboards.js:2181, otherwise the two screens still disagree. Edit 1 is required either way.

Standard repo steps: bump nothing by hand (pre-commit hook handles APP_VERSION/CACHE_VER).

### F54 — Team invite gate (`pres`) doesn't match firestore.rules: the Accountant sees "+ Invite Member" but the users/{uid} write is denied AFTER the Auth account is created (half-created account, wrong role on recovery); the Corporate Secretary is denied a button the rules authorise

`SECURITY`

**What is true**

The structural defect is real and I confirmed every cited line in the working tree (HEAD a65c75d; js/screens/people.js and firestore.rules are both unmodified). js/screens/people.js:391 `const pres = currentRole === 'president' || currentRole === 'manager' || currentRole === 'finance';` renders the invite button (:399) and binds the handler (:497) — `pres` is used nowhere else in renderTeamTab, so it is purely the invite gate. The handler commits the irreversible step first: :534 `createUserWithEmailAndPassword` → :536 `await secondaryApp.delete()` → :538-544 `_counters/employees` transaction → :545 `db.collection('users').doc(uid).set(...)`. firestore.rules:137-150 admits only `isSeniorAdmin()` (president/manager, :30) or `isAdmin()` (adds secretary, :21) with role in ['employee','agent','finance'], or `isOwner(uid)`. The 'finance' ROLE matches none, and `isFinanceOrAdmin()`/`isMoneyAdmin()` are never called by this rule, so the write is denied. Reachability holds: `_navVariant()` (js/app.js:1341) returns 'staff' for finance, js/config.js:547 puts team-directory in the staff sidebar, and js/app.js:2415 has no role gate. `_counters` (firestore.rules:243) is open to any non-partner, so the flow gets all the way past the counter mint before failing.

The "effect" lens is right that the CLAIMED CONSEQUENCE is overstated, and I follow it in part but not fully. js/app.js:902-921 (`loadUserProfile`) does self-provision a missing profile on first sign-in (`role: 'employee', departments: []`), and firestore.rules:140-149 permits that owner-create, so the account is not a permanently unrecoverable ghost. But the effect lens overcorrects on two points I checked directly: (1) the password-reset email is sent at people.js:566, AFTER the denied write — so on the failure path NO email is ever sent and the invitee holds an account with a 10-char random password nobody knows; they cannot sign in and self-heal until someone re-runs Invite and takes the `auth/email-already-in-use` → "Resend Reset Email" branch (:572-590), which the accountant has no way to know is the repair path since all they saw was `Notifs.showToast('Error: '+err.message)` (:592) = "Missing or insufficient permissions". (2) There is no open self-signup in this app — the Sign Up screen only writes `signup_requests` (js/app.js:1105); the only client callers of `createUserWithEmailAndPassword` are this invite (people.js:534) and worker creation (js/screens/dashboards.js:5476). So the finance role really can conjure an Auth account for an arbitrary email that then self-provisions into a live Employee account, which is exactly what firestore.rules:137-150 was written to withhold from finance. That is a genuine (if low-magnitude — lands at the lowest role, no departments) crossing of a role boundary, which is why I keep security=true; the data layer is fail-closed, so nothing is exposed and no privilege is gained by the actor.

Residual damage, accurately: a wrong-role/no-department account, silently discarded name/phone/role/departments, one burned employee-ID sequence number (a second is burned by the self-provision mint), a misleading error, and no repair by the accountant — firestore.rules:197-208 gives 'finance' no update branch at all (not even `isAdmin()`), so a president/manager must fix the role afterwards. Severity medium, not high. The inverse half of the finding also confirmed and unrefuted: secretary IS in the 'admin' nav variant (js/app.js:1341) and reaches the Team page via js/config.js:500, but is excluded from `pres` at people.js:391, so the one role the rules explicitly provision for staff onboarding never sees the button.

**Fix**

All edits in js/screens/people.js (renderTeamTab / the invite handler). Bump nothing by hand — the pre-commit hook handles APP_VERSION and CACHE_VER.

1. Align the client gate with the rule (js/screens/people.js:391). Replace
   `const pres = currentRole === 'president' || currentRole === 'manager' || currentRole === 'finance';`
   with
   `const canInvite = ['president','manager','secretary'].includes(currentRole);`
   and rename the two consumers (:399 render, :497 handler bind). `pres` has no other use inside renderTeamTab, so this is a contained rename. This simultaneously removes the finance false-positive and restores the secretary's authorised capability. (Leave the identically-named `pres` at :1163 and :1601 alone — those are attendance/leave screens, a different question.)

2. Restrict the role dropdown to what the rules will accept for the signed-in role (people.js:507-511, the `Object.entries(window.ROLES||{})` map). Compute
   `const senior = ['president','manager'].includes(currentRole);`
   `const allowedRoles = senior ? Object.keys(window.ROLES||{}) : ['employee','agent','finance'];`
   and filter the `<option>` list by `allowedRoles`. Without this, giving the secretary the button just moves the same half-created-account bug onto them the moment they pick manager/president/partner (firestore.rules:138-139 caps isAdmin() at employee/agent/finance).

3. Make the Auth account rollback-able instead of orphaned (people.js:531-570). Today `await secondaryApp.delete()` runs at :536, before the Firestore write, which destroys the only handle that can undo the Auth user. Restructure to keep the secondary app alive across the Firestore write:
   - delete line 536; hold `secondaryApp` and `cred` in variables declared outside the inner try;
   - wrap the counter transaction + `users/{uid}.set(...)` + `sendPasswordResetEmail` in an inner try;
   - in the inner catch, roll back before rethrowing: `try { await cred.user.delete(); } catch(_) {}` — the secondary app is still signed in AS the new user, so a self-delete is permitted and leaves no orphan and no burned email address;
   - tear the app down in a `finally`: `try { await secondaryApp.delete(); } catch(_) {}`.

4. Replace the generic surfacing at :592 with a message that distinguishes the two states, e.g. `permission-denied` / "Missing or insufficient permissions" → "Your role can't create team accounts — ask the President or a Manager to send this invite." and, if the rollback in step 3 itself failed, say plainly that an Auth account for that email may already exist and to use Resend Reset Email rather than re-inviting.

Optional hardening (separate, not required to close this): move the `_counters/employees` mint (people.js:538-544) to after the users write succeeds, so a denied invite doesn't consume a sequence number.

No firestore.rules change is needed — the rules are the correct, intended boundary here; the client is what is out of step. No index or CLAUDE.md-listed deploy step beyond the normal `git push origin master`.

### F57 — Attendance 50%→100% upgrade fires only from the ✓ Mark Read button; tapping a notification row or "Open" (the path the app itself instructs) reads it without ever upgrading, permanently stamping a present employee's day at 50%

**What is true**

CONFIRMED by direct read of the tree. `window.tryUpgradeAttendanceOnNotifRead` (js/app.js:2487) is the only self-service writer of `attendanceScore: 1.0` — a repo-wide grep for `attendanceScore` returns only it, the Time-In write at js/screens/dashboards.js:1888, and admin/leave writes in js/screens/people.js that all stamp `editedBy`. It has exactly one call site: js/notifications.js:404-405, inside the `.notif-read-btn` handler, gated on `remaining === 0`. The `.notif-view-btn` ("Open", js/notifications.js:437-454) and `.notif-item-main` (row tap, :460-477) handlers both do `item.querySelector('.notif-read-btn')?.remove(); await markRead(...)` then `_navigateFromNotif(...)` — no upgrade call, and `_navigateFromNotif` (:142) immediately hides the panel. The two re-attached nested read handlers (:392-398, :422-430) also omit it. `markAllRead` (:110, exported :1344) omits it and has zero callers repo-wide. Reachability is unrestricted: the bell is an ungated topbar control (index.html:222), mobile routes to the full notifications page fed by the same `_renderIntoList` handlers, and firestore.rules:364-366 explicitly PERMITS the owner self-upgrade — the boundary is not the blocker, the client simply never fires the write. Worse, the app instructs the broken path verbatim: js/screens/dashboards.js:1901 toast "🟡 Timed in (50%). Open 🔔 and check off every notification before 9:00 AM for 100%" and :1755/:1759 "Tap the 🔔 bell → check every notification ... → 100%".

Corrections to the finding, all adopted: (1) MONEY IMPACT IS ZERO — I verified js/money-core.js:144-145, where `attScore`/`perfFactor` reach `netBeforeCA` only under `policy === 'performance'`; js/departments.js:1746/1761 defaults to 'flat' and every caller (js/screens/hr.js:2184, :2194, :2333) is `await window.computePayRun(month)` with no options, so 'performance' is unreachable and the payslip changes by ₱0.00. The effect lens is right and the finding's payroll framing is wrong — hence money=false and severity medium, not high. (2) "each tap ALSO deleted that item's ✓ button" is only momentary — the onSnapshot listener (js/notifications.js:21-34) re-renders the whole panel on every markRead write, so the row returns as read with an "Unread" button; the button removal is cosmetic and is not the cause. (3) "no way to fix themselves" is false — clicking Unread then the freshly-rendered ✓ Mark Read re-enters the :369 handler and does fire the upgrade (still subject to the 9:00 AM / extension cutoff at js/app.js:2495), and admin correction at js/screens/people.js:1438 works. That workaround is undiscoverable, so it does not save the finding. (4) The cite "dashboards.js:1962-1968" for the SOP is wrong (that block is DEFAULT_SOPS Daily Attendance and never mentions notifications); the real instructions are :1755/:1759/:1901, which the finding also cites correctly. (5) Partial mitigation the finding omits: js/screens/dashboards.js:1880-1888 grants 1.0 at Time In via `autoFull` when the day's notifications are already all read — so read-then-time-in works; only the app-instructed time-in-then-read order breaks. Net: a real, daily-reachable HR-record correctness defect that persists in the monthly attendance % (getAttendanceScore, dashboards.js:3032), the payslip's informational Attendance line (js/screens/hr.js:4594) and the standings ranking (js/screens/people.js:800, `0.4 * attScore`) — not a pay defect.

**Fix**

Two edits; make the guard authoritative server-side rather than DOM-derived.

1) js/app.js — `window.tryUpgradeAttendanceOnNotifRead` (line 2487): move the "are there unread items left?" test INSIDE the function so no caller has to compute it. After the existing timed-in / already-full / `editedBy` guards (:2504-2507) and before the `set()` at :2509, add the same query Time In already uses (js/screens/dashboards.js:1880-1883):
  const todayStart = new Date(todayStr + 'T00:00:00+08:00').getTime();
  const notifSnap = await db.collection('notifications').doc(currentUser.uid).collection('items')
    .where('createdAt', '>=', new firebase.firestore.Timestamp(Math.floor(todayStart/1000), 0)).get();
  if (!notifSnap.docs.every(d => d.data().read)) return;   // silent no-op, not a toast
Also move the existing `pastDeadline` toast so it only fires when this unread check passes — otherwise every mid-morning row tap would toast "deadline passed". This also fixes a latent correctness bug in the current gate: `remaining` counts only the 30-item live listener window (js/notifications.js:24 `.limit(30)`), so a user with >30 unread could already be upgraded early; the Firestore check is the same source of truth Time In uses.

2) js/notifications.js — call it from every read path. Add one module-level helper next to `_updatePanelHint` (~:479):
  function _afterMarkRead() { if (typeof window.tryUpgradeAttendanceOnNotifRead === 'function') window.tryUpgradeAttendanceOnNotifRead(); }
Then invoke `_afterMarkRead();` immediately after each `await markRead(...)` at: :404-406 (replace the `remaining === 0 &&` DOM gate — keep `_updatePanelHint(remaining, items.length)` for the hint text only), :398 and :430 (the two re-attached nested read handlers), :451 (the `.notif-view-btn` Open handler — place it BEFORE `_navigateFromNotif(...)` on line 453, which hides the panel), :474 (the `.notif-item-main` row-tap handler, before `_navigateFromNotif` on :476), and at the end of `markAllRead()` (:110-131) after the drain loop.

3) Secondary cleanups in the same pass (not required for the fix): `markAllRead` is exported at js/notifications.js:1344 with zero callers, while js/screens/dashboards.js:6123 tells users to "Tap Mark all read" — either wire a Mark-all-read button into the panel header and keep the export, or delete both the dead export and the stale help line. Bump `CACHE_VER`/version per the repo's pre-commit hook rules.

### F59 — Clock card labels a carried-over open shift as "Today", and the forgotten-clock-out dialog tells the worker to ask HR for a fix no screen can perform (HR kiosk hard-codes bizDate())

**What is true**

The mechanism is real and verbatim-accurate; the claimed consequence is not. Verified in the tree: js/screens/worker.js:282-289 `_resolveActiveRecord` back-walks exactly one day and returns yesterday's open record; `_loadClockCard` (worker.js:311-312) keeps only `active.data` and throws away `active.dateStr`, so the header at worker.js:347 prints literally "Today" + `new Date().toLocaleDateString(...)` above `Timed in at ${rec.timeIn}` (worker.js:377) — yesterday's time under today's date. `hasIn = !!(rec.timeIn && rec.inValid)` (worker.js:323) then renders ONLY `wb-timeout-btn` (worker.js:381-383); `wb-timein-btn` (worker.js:388) is in the mutually exclusive else. functions/index.js:1833-1837 agrees server-side ('shift-already-open'). And the confirm dialog at worker.js:762 really does say "DON'T tap Time Out — leave this open and ask HR/Finance to correct your record directly", while the ONLY admin write path, `openWorkerKioskModal`, hard-codes `bizDate()` for both the preview read (hr.js:3138) and the write (hr.js:3164). A repo-wide grep confirms the only other attendance_worker writes are worker.js:496/604/654 (self-service, writes only attempts/pendingPunch). So no screen can close a PAST day's record — the advice the app gives is unfulfillable. That much I confirm.

The "effect" refuter is right on the part that matters, and I follow it. (1) Path (a) is NOT a trap: tapping Time Out writes timeOut onto Monday's doc (functions/index.js:1882-1886), after which both `_resolveActiveRecord` and `resolveActiveRecordServer` stop returning it, Tuesday's TIME IN immediately works, and Monday's phantom hours are stamped needsReview (functions/index.js:1963) and EXCLUDED from the payslip auto-sum into a "Needs review before paying" list (hr.js:4101-4115). (2) The lockout is one calendar day, not permanent — both walkers look back exactly one day, so on day+2 the empty today-doc falls through and TIME IN returns. (3) "~PHP 500 unpaid / unrecoverable" is wrong: firestore.rules:405 lets finance/admin write ANY date (this is a missing date picker, not a data lock), the HR kiosk's `bizDate()` IS Tuesday and writes exactly the allegedly-lost doc, and the payslip time log rows are plain hand-typed inputs (hr.js:3660-3661, read at hr.js:4325-4327) that default to a full 8h day — pay never depends on an attendance_worker doc existing. If anything the at-risk day is MONDAY, not Tuesday: a dangling timeIn-with-no-timeOut record has no `needsReview` and no numeric `hoursWorked`, so hr.js:4090-4100 loads it with a BLANK Time Out and 0.00h — visibly blank in the row and in Computed Total, hand-fixable, so not a silent money defect.

The "reach" refuter also flagged a real residual the code refuter caught: the kiosk write (hr.js:3164) sets neither `inValid` nor `outValid`, so after an HR correction `hasIn`/`hasOut` are both false and the worker's card reverts to a TIME IN button whose tap the server rejects with reason 'already-recorded' (functions/index.js:1852-1856). Confusing, no pay impact.

Net: a genuine UX/admin-tooling defect — mislabelled card + self-inflicted dead-end advice + an HR kiosk with no date field — not a high-severity unrecoverable pay loss. Severity high -> medium; money=false.

**Fix**

Three edits, all UI-layer; firestore.rules:405 already permits finance/admin writes to any date, so no rules change is needed.

1) js/screens/worker.js — stop mislabelling a carried-over shift. In `_loadClockCard` (worker.js:311-312) capture the whole resolver result, not just `.data`:
   `const active = await _resolveActiveRecord(profile.id); rec = active.data || {}; const recDateStr = active.dateStr;`
   Then at the header (worker.js:347) branch on `recDateStr !== window.bizDate()`: render "Yesterday's shift — still open" plus the RECORD's date (formatted from `recDateStr`) instead of the literal "Today" + `new Date()`. Add a one-line explainer in the `hasIn` body block (worker.js:377) — e.g. "This is your unclosed shift from <date>. Time Out to close it, then you can Time In for today." — so the worker understands why there is no TIME IN button.

2) js/screens/worker.js:757-766 — rewrite the long-shift confirm copy so it no longer points at a capability that does not exist. Drop "leave this open and ask HR/Finance to correct your record directly" and replace with the truthful path: "Tap Time Out to close it — it will be flagged for HR review and won't be paid as-is. Then tell HR your real out time. Leaving it open blocks your Time In for the rest of today." Also fix the cancel `setStatus(...)` at worker.js:764 the same way.

3) js/screens/hr.js `openWorkerKioskModal` (hr.js ~3114-3172) — add a date field and stop hard-coding `bizDate()`:
   - Add `<input id="kiosk-date" type="date" value="${bizDate()}" max="${bizDate()}"/>` to the modal body and replace the static "on ${bizDate()}" caption with a live-updating one.
   - Replace the preview read at hr.js:3138 and the write at hr.js:3164 with `const dateStr = document.getElementById('kiosk-date').value || bizDate();` and use `...records.doc(dateStr)` / `date: dateStr` in both. Re-run the existing-record preview when the date input changes (move the IIFE at hr.js:3134-3155 into a named `refreshKioskPreview(dateStr)` and bind it to `change`).
   - In the save payload at hr.js:3165-3168 also stamp `inValid: true, outValid: true, source: 'hr-kiosk'` so the worker's card at worker.js:323-324 recognises the corrected day as complete ("Done for today") instead of offering a TIME IN the server then rejects with 'already-recorded'.
   - Optional but closes the loop the finding is really about: when the chosen date's record has `timeIn` and no `timeOut`, prefill Time In from the record and label the Save button "Close this open shift", and set `needsReview: true` on that write so it still lands in the payslip "Needs review before paying" list rather than silently auto-summing.

Bump CACHE_VER handling is automatic via the pre-commit hook; no index.html/sw.js PRECACHE change is needed since no new file is added.

---

## LOW (10)

### F07 — Payroll write buttons (incl. "Mark Verified") render for the Corporate Secretary, whom firestore.rules denies — the click is a silent no-op with no toast

**What is true**

REAL but misdiagnosed and overstated; downgraded high → low, and one of its two claimed victims is wrong. Confirmed exactly as quoted (line numbers drifted ~+50/+205): js/screens/hr.js:865 `const canFinance = isFinancePriv()` = canEditDept('Finance'), true for `secretary`; hr.js:2232 gates `#pr-verify-btn` on it; firestore.rules:892-895 permits the computed→verified update only for isMoneyAdmin() (president|manager|finance), which deliberately excludes secretary (rules:883-885 says so in a comment); and the write at hr.js:2249 has no try/catch, so the denial only reaches js/errlog.js:102 (Firestore-only, no toast). The secretary path is fully reachable (app.js:1341 secretary→admin sidebar → config.js:501 dept:HR → hr.js:351 admits secretary → hr.js:361 Payroll card → renderPayrollHub → renderPayrollManagement). So a dead button that fails invisibly is real. The `reach` lens correctly refutes the Finance-DEPARTMENT half: firestore.rules:889 `allow read: if isFinanceOrAdmin()` is role-based (rules:22), so a role-'employee' Finance-dept member is read-denied, hr.js:2211's `.catch(()=>null)` degrades state to 'draft', and the button never renders — and hr.js:351 bars them from the HR hub anyway. I followed that refutation. The `effect` lens correctly refutes the consequence, and I followed it too: canFinance is also true for the President, who matches isMoneyAdmin() and must open this same hub to Disburse, so one click by the person already required to be there advances the run; the strip is a one-shot `.get()` (no onSnapshot), so the badge row keeps showing the truthful 'Computed' — no phantom success; and loadUnpaidStrip (hr.js:1206-1240) plus the red overdue banner (hr.js:2220) loudly surface any undisbursed month. Impact is ₱0 — pay_runs is governance metadata, the money path is the president-only window.disbursePayRun (departments.js:1866), and the denied set() is atomic. This is not a security defect either: the rules are the boundary and they hold fail-closed; the UI is merely dishonest about it. I did not follow the `code` lens's STANDS on severity — it verified the constructs (correctly) but never tested whether the consequence followed. Scope is also wider than the finding says: the same canFinance flag gates five more secretary-dead write controls in the same function (hr.js:988/1010 history edit, :1310 payslip note, :1423 raise, :1424 exclude, :1464 include). The repo already fixed this exact class once — hr.js:4690-4703 narrows the payslip Edit button to ['president','manager','finance'] with a comment explaining that mirroring canFinance "would show secretary a button whose Save always fails server-side" — and simply never applied it here.

**Fix**

Two small client-side edits; no firestore.rules change (the rules are correct as written).

1) Add one shared client-side mirror of isMoneyAdmin() next to isFinancePriv() in /Users/neilbarro/Library/CloudStorage/OneDrive-Personal/BARRO INDUSTRIES copy/Operation Systems Development/js/departments.js (after line 27):
   `// Client mirror of firestore.rules isMoneyAdmin() (rules:31). NARROWER than
    // isFinancePriv(): excludes 'secretary' and Finance-DEPT members, who are
    // denied every pay_runs/payroll/salary_history write server-side.
    function isMoneyAdminClient() { return ['president','manager','finance'].includes(window.currentRole || ''); }
    window.isMoneyAdminClient = isMoneyAdminClient;`

2) In js/screens/hr.js `renderPayrollManagement`, change line 865 from
   `const canFinance = isFinancePriv();`
   to
   `const canFinance = isMoneyAdminClient();   // NOT isFinancePriv(): rules:892 requires isMoneyAdmin()`
   This one-line change fixes #pr-verify-btn (:2232) and the five other dead write controls it gates (:988/:1010 history edit, :1310 pr-note-btn, :1423 raise-emp-btn, :1424 pr-exclude-btn, :1464 pr-include-btn). Secretary keeps full read/oversight of the payroll hub, which is the intended WS19 posture. While there, collapse the duplicate `_payslipCanEdit()` at hr.js:4702 to `return isMoneyAdminClient();` so there is one definition of the money-write boundary.

3) Defence in depth — make the write's failure visible. Replace the bare listener at js/screens/hr.js:2242 with the repo's own wrapper from js/departments.js:29 (already used at hr.js:3407/3445/3454/3469):
   `const vbtn = document.getElementById('pr-verify-btn'); if (vbtn) onClickSafe(vbtn, async () => { ...existing body... });`
   so any future permission/network denial raises `Action failed: <message>` instead of dying in onunhandledrejection. Do the same for the pr-disburse/pr-reopen/pr-resume/pr-unlock listeners in the same block, which share the pattern.

4) Nothing else needed: the pre-commit hook auto-bumps APP_VERSION and derives CACHE_VER, so the SW cache-bust is handled on commit.

Verification: sign in as a `secretary` on a month at state 'computed' — the Verify/raise/exclude/note/edit buttons should be absent (view-only strip), while president/manager/finance still see and can click them successfully.

### F13 — Team card's 4-button action row doesn't wrap and overflows its card on 2-column phone widths — up to ~4px of the last (Remove) button's padding is shaved by #page-content's overflow-x:clip; cosmetic, the icon and hit area survive and Remove is confirm-gated

**What is true**

The layout defect is real but both the magnitude and the consequence were wrong. I reproduced it in Chromium against an unmodified copy of css/styles.css with the repo's coarse-pointer block force-applied, using the real .team-masonry > .team-member-card > .team-card-actions > 4x .team-card-btn markup.

What is true: js/screens/people.js:966-974 renders up to four buttons (view card / DM / nudge / remove-reinstate) into .team-card-actions, which is `display:flex; gap:6px; justify-content:center` with NO flex-wrap (css/styles.css:3821-3824, the only rule for that class). The card is a column flex container with `align-items:center` (css/styles.css:3722-3731), so the row is a shrink-to-fit item whose fit-content width bottoms out at its min-content width, and #page-content is `overflow-x: clip` (css/styles.css:1240). At 2-column widths the row is wider than the card and the right-hand column's last button gets shaved.

Where the finding is wrong — the "effect" refuter is right and the "code" refuter's arithmetic is wrong. The finding (and the code lens) computed the row at 186px = 4x42 + 3x6, assuming the buttons keep their content width. They don't: the coarse block (css/styles.css:7005-7010) sets an EXPLICIT `min-width: 40px`, which replaces min-width:auto and therefore lets each button flex-shrink BELOW its 42px content size to 40px. Measured: buttons 40px, row 178px, at every icon rendering. Consequences of the correct number:
- 393x852 (the width the finding claims to have measured): card 178.5px, row 178px, last button right edge 382.75 vs #page-content right 383 — spill and clip are -0.25px, i.e. NOTHING is clipped. The finding's "3.75px clipped at 393px" does not exist.
- 375x812: card 169.5, row 178 -> 4.25px of the last button clipped. The 16px icon spans 341.25-357.25 against a clip edge of 365, so the glyph is fully visible with 7.75px to spare and the button keeps a ~36x38px hit area.
- The band is narrow: the clip only occurs where the card is under 178px, i.e. roughly 336-391 CSS px viewport (375 iPhone SE/mini/X-11Pro = 4.25px, 390 iPhone 12-14 = 0.5px). At 320px the grid collapses to one column and there is no overflow at all; at >=393px there is none either.

Where the finding is worst — the load-bearing consequence is false. "A mis-tap deactivates a staff account" is not possible. js/screens/people.js:1022-1031 awaits `confirmDialog({title:'Remove from system', message: 'Remove <name> from the system? ... can be undone from this same card at any time (Reinstate)', danger:true})` and `if (!ok) return;`; the write then goes through the `setUserDisabled` callable (people.js:1040-1042), and firestore.rules:191-195 restricts other-user removed-flag writes to hasOnly(['removed','removedAt','removedBy','reinstatedAt','reinstatedBy']). The neighbouring Nudge button confirms too (people.js:995). A mis-tap costs a dismissed dialog. "All four buttons sit outside the card" is also overstated — the row overhangs the card's 1px border by at most 4.25px per side and the 16px grid gutter means it never reaches a neighbouring card, so ownership is never ambiguous.

The "reach" lens is right that the screen is a no-gate bottom-nav tab (js/config.js:564, js/app.js:2415, js/screens/people.js:389/442) and that the 4th button renders for president/manager/HR (people.js:913), so the owner does hit this — but it is only ever a sub-5px cosmetic shave of empty padding plus the outer buttons overlapping the card's rounded border. Real, reproducible, worth a one-line CSS fix; not a hidden destructive control.

**Fix**

Two-line CSS change, no JS change needed.

1. css/styles.css:3821-3824 — let the action row live inside the card's content box and wrap instead of overflowing:
   .team-card-actions {
     margin-top: 6px;
     display: flex; gap: 6px; justify-content: center;
     flex-wrap: wrap;            /* new — was the whole bug */
     align-self: stretch;        /* new — override the card's align-items:center so the row is the card's 148.5px content box, not shrink-to-fit at 178px min-content */
   }
   `align-self: stretch` alone stops the buttons overhanging the card border; `flex-wrap: wrap` stops the clip by letting the 4th button drop to a second line when 4 buttons no longer fit.

2. css/styles.css:7005-7010 (the `@media (hover: none) and (pointer: coarse)` block) — shrink the buttons enough that the wrap only happens on genuinely narrow phones, while staying at/above the 38px touch floor:
   .team-card-btn { min-height: 38px; min-width: 38px; padding: 8px 10px; }
   and add, in the same block: .team-card-actions { gap: 4px; }
   (4 x 38 + 3 x 4 = 164px — fits any card content box >= 164px, so wrapping is confined to the smallest 2-column widths rather than being the norm.)

Verify by re-running the measurement at 375x812 and 393x852: `.team-card-actions` right edge must be <= `.team-member-card` right edge and <= `#page-content` right edge for the right-hand column.

Then bump the version per CLAUDE.md (the pre-commit hook handles APP_VERSION / CACHE_VER). No firestore.rules or people.js change is warranted — the Remove flow's confirm-gate, callable-function write and rules field allowlist are all already correct.

### F20 — Shared finance CRUD table renders icon-only Edit/Delete buttons with no accessible name (WCAG 4.1.2, Level A) on four Finance tables

**What is true**

The code defect is real and I confirmed every line myself. js/ui-crud-table.js:84-85 emits `<button class="... crud-edit-btn" data-id="...">${emojiIcon('✎',16)}</button>` and the matching `crud-del-btn` with `${emojiIcon('trash-2',14)}` — no aria-label, no title, no text node. js/config.js:358-364 confirms emojiIcon returns a bare `<i data-lucide="pencil">` / `<i data-lucide="trash-2">` (the latter via the raw-name regex fallback, not LUCIDE_EMOJI_MAP — an immaterial slip in the finding), which lucide.createIcons swaps for an `<svg>` with no title/role/aria-label. The actions header at :102 is a literal empty `<th>`, no `<th>` carries scope=, and there is no `<caption>`. Grep over js/, css/styles.css and index.html for `crud-edit-btn|crud-del-btn` returns ONLY ui-crud-table.js:84,85,139,148 — nothing labels them later, and there is no global aria sweep. Reachable and live: index.html loads the file, and the four callers at js/screens/finance.js:400/1661/1765/1883 are Taxes, Cash Receipts, Cash Disbursements and Records — all chip-tab members on the Finance screen, rendered when isFinancePriv() → canEditDept('Finance') is true (president/owner/manager/secretary, the finance role, any Finance-dept member). So the code lens and reach lens are both correct.

The effect lens is also correct, and I follow it on impact. I read js/departments.js:579-601: the President path is gated by `confirmDialog({ message: 'Delete ${label}? This cannot be undone.', danger:true, html:true })`, and every other user gets a focus-trapped modal titled "Request Deletion — President Approval" that names the exact record and requires a non-empty `#fdr-reason` plus a separate text-labeled "Submit for Approval" click before the `finance_delete_requests.add()` on :599. A mispress therefore writes nothing, and the dialog itself discloses which button was hit and against which record. The finding's claimed consequence — "mispressing generates a spurious deletion request against a real ledger record" — is false, so IMPACT: high is wrong. money=false, security=false. What survives is a genuine WCAG 2.1 SC 4.1.2 (Name, Role, Value) Level A failure: a screen-reader user hears "button, button" per row on four finance tables and must activate one to learn which it is. Notably the codebase already follows the correct convention elsewhere for identical controls — js/departments.js:1411-1412 `aria-label="Edit promo"` / `aria-label="Delete promo"` and :3530 `aria-label="Delete client"` — so this is an inconsistency in the shared component, not a missing convention. Low severity: friction on a privileged-only surface, no data or peso figure at risk, but a trivially cheap Level A fix that fixes all four tables at once.

**Fix**

Single file, js/ui-crud-table.js, inside window.renderFinanceCrudTable. No caller changes — cfg.deleteLabel(r) already supplies per-row context and is already escaped for the data-label attribute.

1. actionsCellHtml (lines 83-88): compute the row label once and put it on both buttons.
   const rowLabel = escHtml(cfg.deleteLabel(r));
   editBtn: add `aria-label="Edit ${rowLabel}"` (keep data-id as-is).
   delBtn:  add `aria-label="Delete ${rowLabel}"` alongside the existing data-label="${rowLabel}".
   Guard for callers that might not define deleteLabel: `const rowLabel = cfg.deleteLabel ? escHtml(cfg.deleteLabel(r)) : 'record';` (all four current callers define it; actionsMode:'always' callers could not).
   Also mark the emitted icons decorative so AT does not double-announce once a name exists — either wrap as `<span aria-hidden="true">${emojiIcon(...)}</span>` on both buttons.

2. headerRow (line 102): add scope and a non-empty accessible header for the actions column.
   `<tr>${cfg.columns.map(c => `<th scope="col">${c.header}</th>`).join('')}${showActionsCol ? '<th scope="col"><span class="sr-only">Actions</span></th>' : ''}</tr>`
   .sr-only already exists at css/styles.css:176, so no CSS change is needed.

3. Optional, same edit: give the table a name at line 114 — `<table class="data-table table-cards"><caption class="sr-only">${escHtml(cfg.emptyLabel || collection)}</caption>` — so multiple tables on one Finance tab are distinguishable.

Per CLAUDE.md this is a .js edit, so the pre-commit hook must bump window.APP_VERSION in js/config.js (CACHE_VER in sw.js derives from it) — do not hand-edit the version. No Firestore rules or index changes; nothing in this fix touches financeDelete, financeEditModal, or any write path.

### F24 — Service worker prefers a non-ok network response over a valid cached copy (transient breakage on origin 404/5xx), but does NOT durably cache poison

**What is true**

Real but overstated and misdiagnosed. What is code-true and reachable: networkFirstTimeout returns the race winner at sw.js:252 with no status check, even though a valid cached copy was already resolved at sw.js:238 — so a 404/429/5xx arriving inside the 400ms window is handed to the page as js/app.js (or any script/CSS), producing a SyntaxError-style half-dead load during a GitHub Pages deploy blip or a Fastly 5xx. networkFirst (sw.js:256-271) has the same defect in a different shape: it only falls back to cache inside catch, never on a bad status; it covers same-origin non-js/css/img/html (e.g. /products-database.json) and cross-origin non-CDN requests. Both refuters (reach, effect) are correct on the headline and I follow them: the captive-portal cache-poisoning story does not hold. Line 227 gates cache.put on r.ok, so poisoning requires a genuine 200 on the app's own origin; production is HTTPS (CNAME barroindustries-operatingsystem.ravenmails.com, GitHub Pages) and a service worker only runs in a secure context (js/app.js:4861), so a portal cannot return a 200 for https://origin/js/app.js without a trusted MITM CA — interception makes fetch reject, hits .catch(() => null), and the good cached copy is served, which is correct behaviour. There is no 404.html in the tree, so GH Pages 404s carry status 404 and are never cached. Effect lens is also right that nothing is deploy-gated: the unconditional re-fetch + re-put at line 227 overwrites any bad entry on the first successful load, so 'permanently bricked until the next version deploy' is false. The code lens verdict of STANDS is right about the lines existing but did not test the delivery path; its own correction concedes the portal story is the weakest link. The finding also misattributes the 404 half to networkFirst — same-origin JS/CSS route to networkFirstTimeout at sw.js:163-166 and never reach networkFirst. Net: transient, self-healing, one extra reload; impact low, not high. Worth the two-line fix because the cached copy is right there and returning the error instead is strictly worse than the no-SW baseline the SW exists to improve on.

**Fix**

Two small edits in /Users/neilbarro/Library/CloudStorage/OneDrive-Personal/BARRO INDUSTRIES copy/Operation Systems Development/sw.js, both "prefer a good cached copy over a bad network status".

1) networkFirstTimeout (sw.js:225-254), replace the return at line 252:
   from `if (winner && winner !== '__timeout__') return winner;`
   to   `if (winner && winner !== '__timeout__' && winner.ok) return winner;`
   Line 253's `return cached;` then covers both the timeout case and the non-ok case. Note `cached` is guaranteed non-null here (the `!cached` branch returned at sw.js:239-246), so no extra guard is needed. Leave the no-cache branch at 242 as-is — returning the non-ok network response when there is nothing cached is the correct no-SW baseline.

2) networkFirst (sw.js:256-271), inside the try after the fetch:
   keep `if (response.ok) { const cache = await caches.open(cacheName); cache.put(request, response.clone()); return response; }`
   then add `const cached = await caches.match(request); return cached || response;`
   so a non-ok status falls back to a cached copy when one exists, matching the catch branch's behaviour.

3) Optional defence-in-depth (not required by any demonstrated vector, and explicitly NOT the fix for the reported captive-portal claim): before `cache.put` at sw.js:227, skip writing when the response looks wrong for the route — e.g. `if (r && r.ok && !r.redirected && r.type !== 'opaqueredirect') cache.put(request, r.clone());`. Cheap insurance against a redirect-to-portal on a future non-HTTPS/dev origin; do not sell it as closing a live hole.

Per CLAUDE.md, CACHE_VER in sw.js is derived from APP_VERSION by .githooks/pre-commit — do not hand-edit line 23; just commit so the hook bumps it. No Firestore rules or index changes involved. No test suite exists; verify by serving locally (`npx serve -p 3838 .`), throttling to force a cache hit, and confirming a forced 404 on one js file now yields the cached copy rather than the error body.

### F30 — Personal-Finance "Delete" destroys the President's OWN salary_history row with no cascade and no audit entry — silently drops that person-month from the BIR 1601-C / alphalist / payslip-YTD worksheets (ledger and cash are unaffected)

**What is true**

The code exists as quoted (js/screens/dashboards.js:2698-2705, raw `db.collection('salary_history').doc(id).delete()`), it is the only salary_history delete in the codebase that bypasses `window.financeExecuteDelete` (the other three — svc-approvals.js:83, hr.js:1114, hr.js:1165 — all cascade), and firestore.rules:821-826 permits it. But BOTH of the finding's claimed consequences are wrong, and I verified the effect lens's refutation myself rather than taking it on trust.

(1) "Payroll expense permanently overstated on the Finance Overview" is false. The handler stages zero ledger writes, and no finance screen reads salary_history at all — `grep salary_history js/screens/finance.js` returns nothing; the Overview is fed by `db.collection('ledger')`. The ledger after the delete is byte-identical and still balanced: the per-employee `PAY-{month}-{uid}` + `-ER` debits (departments.js:2291-2307) match the aggregate SSSPAY/PHPAY/HDMFPAY/WHTPAY/CADEDUCT/EMPDED/NETPAY credit legs (departments.js:2340-2428) for a run that really was disbursed. Book impact: ₱0.00. The route the finding holds up as correct is the one that unbalances the books — financeDeleteCascade removes only the two per-employee DEBITS and its own comment (departments.js:507-513) admits the aggregate credit legs "are NOT adjusted here … Known gap", which bir.js:607 already surfaces as "a deleted employee payroll leaves the aggregate legs overstated".

(2) "The employee's loan is written off by accident" is inverted. The installment really was collected — netCashAgg is reduced by actualCa (departments.js:2266) and CADEDUCT-{month} credits Advances to Employees — so leaving the CA at balance 0 / status 'paid' is factually correct. The cascade's `increment(cd.amount)` + `status:'approved'` restore (departments.js:517-528) hands back a balance the borrower already repaid, and config.js:2698 (`payments[].some(source==='payroll' && month===month)`) guarantees a re-disburse can never re-collect it.

(3) The scenario's reach is also wrong. `renderPersonalFinance`'s president/manager branch (`pres` at dashboards.js:2181) ends in a bare `return;` at :2374, before the Salary History card exists. The Delete button (2627-2628) lives only in the "Employee sees their own" branch, whose rows come from `where('userId','==',currentUser.uid)` (:2399), and every call site passes `window.currentUser`. A president reaches it solely via My Profile → Finance (people.js:2580, `selfOnly:true`), so the row destroyed is their own. Deleting another employee's record happens on HR → Payroll (hr.js:1104-1114) and that button DOES cascade. (`currentRole==='owner'` at :2627 is dead — not a role in config.js.)

What genuinely survives, and why it still stands: the button permanently destroys a statutory payroll mirror row with no `logAudit` call (unlike every other payroll mutation in dashboards.js), no approval trail, and no parity with its cascading twin. pay_runs and the ledger keep the money while the mirror vanishes, so that person-month silently disappears from bir.js:523's 1601-C per-employee tax total (under-reporting withholding on a filing worksheet — flagged only by the bir.js:606-607 banner), from the annual alphalist/2316 and the 13th-month accrual (bir.js:692/732, hr.js:4512 — display estimates, not a pay driver), and from `payslipYtdMonthly` (hr.js:4541); `_openPayslipForMonth` (dashboards.js:2732) then reports "No payslip found" for a month that was really paid. hr.js's payroll integrity audit only flags salary_history rows with NO run line (hr.js:642-646), never the reverse, so the deletion is otherwise invisible. Recoverable via president Reopen → recompute → re-disburse (departments.js:1938 set-merge, PAY- upserted on a deterministic ref), which is why this is low, not high.

**Fix**

js/screens/dashboards.js, the `.ph-delete-btn` handler (~2698-2705):

1. Give the two president delete paths identical behaviour. Replace the raw call with the same one hr.js:1110-1117 uses, and add the audit + cache lines it has:
   `await window.financeExecuteDelete('salary_history', btn.dataset.id);`
   `window.logAudit && window.logAudit('delete','salary_history', btn.dataset.id, { month: btn.dataset.month, self: true });`
   `if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');`
   (Or simply call `window.financeDelete({ collection:'salary_history', docId: btn.dataset.id, label:`payroll record for ${month}`, onDone:()=>window.renderPersonalFinance(currentUser,currentRole,opts) })` — departments.js:580 — which already branches president-vs-request and folds in the confirm dialog, letting you delete the hand-rolled confirm and the separate `.ph-req-delete-btn` handler.)

2. Preferred, and the reason step 1 alone is not enough: neither route is correct for a DISBURSED month, because financeDeleteCascade drops the per-employee debits while the aggregate credit legs stay (departments.js:507-513, the gap bir.js:607 already warns about). Gate both president buttons: read `pay_runs/{month}` and, if `state === 'disbursed'`, refuse with a toast pointing at Reopen → recompute → re-disburse (the idempotent, ledger-safe correction path). Only allow the delete for rows with no matching disbursed run line — the orphan case hr.js:642-646 flags.

3. Drop the dead `currentRole==='owner'` branch at dashboards.js:2627 (not a role in js/config.js ROLES).

Adjacent defect found while adjudicating, worth its own finding: the finance `.ph-req-delete-btn` handler (dashboards.js:2706-2720) only sends a notification and never writes a `payroll_delete_requests` doc, so `payrollDeleteApprove` (js/svc-approvals.js:75-83) has nothing to act on and the request can never be approved from Approvals — unlike hr.js:1128 which does create the doc.

### F31 — President's raw cash_advances delete in people.js skips the CA- ledger cascade, stranding orphan ledger legs on the provisional FS working paper (real Balance Sheet is doc-derived and unaffected)

`MONEY`

**What is true**

The defect is real but the claimed consequence is wrong, and the effect lens is the one that read the decisive code. What is TRUE: js/screens/people.js:1860-1866 does a bare `await db.collection('cash_advances').doc(id).delete()` with no window.financeDelete/financeExecuteDelete, while the sibling surface js/screens/finance.js:2081 deletes the SAME collection through window.financeDelete — so two delete surfaces for one collection behave inconsistently, and firestore.rules:491 (`allow delete: if isAuth() && isPresident()`) permits the raw write. Reachable: the president lands on this screen via Finance hub > Cash Advances > "+ Add Record" > save (js/screens/people.js:1957 calls renderCashAdvancePage) or a typed `#/cash-advances` (js/app.js:2419, no isPresident guard), and every listed record then shows a Delete button.

What is FALSE — I follow the effect lens here because I verified its central claim myself. The real Balance Sheet does NOT read the ledger for this asset: js/bir.js:962-967 `finCaReceivable` sums `cash_advances` DOCS (`status==='approved' && balance>0`), and js/bir.js:1030-1036 reads the ledger only for liabilities. So deleting the doc makes "Cash Advances Receivable" go DOWN, never up — "permanently overstated by the principal" is backwards. "No screen can reach it to correct" is also false: js/screens/finance.js:1276-1281 renders every ledger row with its `refNumber` plus a delete button wired at 1437-1440 to `window.financeDelete`.

Per-status reality (the code lens's own correction, which I confirmed): pending and rejected deletes are entirely harmless — the `CA-<id>` debit is written only inside `if (result)` after approve() succeeds (js/config.js:2465-2478); reject() and request() post nothing. A fully PAID advance is numerically neutral: the debit is the bare principal and the `CA-<id>-REPAY-<paymentId>` credits retire exactly the principal (js/config.js:2601-2604), and the bank 'out'/'in' tags offset too — two stranded but self-cancelling rows. The ONLY residual case is `approved && balance>0` (button at people.js:1827): a net orphan debit equal to unrepaid principal, visible solely on js/bir.js:893 "3. Balance Sheet — PROVISIONAL", captioned not-an-audited-FS and already carrying an "Unreconciled difference" plug row (js/bir.js:906).

Crucially, the finding's implied remedy is itself unsafe: the cascade at js/departments.js:537-540 stages ONLY `CA-<docId>` and never the `-REPAY-`/`-INT` legs, so routing this handler through financeDelete as-is would drive 'Advances to Employees' NEGATIVE on a paid loan; and because the `CA-` row carries `BankAccounts.tag(bankAccount,'out')` (js/config.js:2474), deleting it raises computed bank cash by the principal even though the money genuinely left. So the fix must repair the cascade before it is adopted. The reach lens is directionally right but adds nothing the code lens missed, and its own correction concedes the finding's "President opens Cash Advances" menu path does not exist (js/config.js:493-511 admin sidebar has no cash-advances entry). Net: a genuine consistency/audit-trail defect worth fixing, not a balance-sheet overstatement — low severity, one-click correctable.

**Fix**

Two edits, and they must land TOGETHER — doing (1) alone makes paid advances worse.

1. Fix the cascade first — js/departments.js, `financeDeleteCascade`, the `cash_advances` branch at lines 537-540. It currently stages only the release leg:
   `} else if (collection === 'cash_advances') { await stageLedgerDelete(`CA-${docId}`); }`
   Extend it to every leg the CA lifecycle writes: `CA-<id>` (js/config.js:2465), `CA-<id>-REPAY-<paymentId>` (js/config.js:2589) and `CA-<id>-REPAY-<paymentId>-INT` (js/config.js:2607). Since payment ids are unknown at delete time, add a `stageLedgerDeletePrefix(prefix)` helper next to `stageLedgerDelete` (js/departments.js:497-502) that runs a Firestore range query — `db.collection('ledger').where('refNumber','>=', p).where('refNumber','<=', p+'')` — and pushes each hit through the same `batch.delete(found.ref)` + `staleLedgerRows.push(...)` path so `financeExecuteDelete`'s post-commit `window.Ledger._syncRollup(row, -1)` (js/departments.js:565-567) still fires per row. Anchor strictly on the exact `CA-${docId}` plus the prefix `CA-${docId}-` so a doc id that is a prefix of another cannot be swept in. Batch stays far under the 500-op limit.

2. Then route the handler — js/screens/people.js, the `.ca-delete-btn` listener in `renderCAList` at lines 1860-1866. Replace the body with the exact shape already used at js/screens/finance.js:2081:
   `window.financeDelete({ collection:'cash_advances', docId: e.currentTarget.dataset.id, label:`cash advance "${...}"`, onDone: () => window.renderCashAdvancePage() });`
   Drop the local `confirmDialog` and the `Notifs.success('Record deleted.')` — `financeDelete` (js/departments.js:580-592) does its own confirm and toast, and for a non-president caller correctly diverts to the `finance_delete_requests` approval flow.

3. Recommended, and the accounting-correct half — do not allow deletion of an approved loan with money still outstanding. In `renderCAList`, remove the Delete button from the `isAdmin && a.status==='approved' && (a.balance||0)>0` block (js/screens/people.js:1824-1828), keeping it only on the pending (1822) and rejected/paid (1831) blocks. Deleting the release leg for an unpaid loan silently raises computed bank cash by the principal via the stranded `BankAccounts.tag(bankAccount,'out')`, which is a worse error than the orphan it removes. Offer a "Write off / Cancel loan" action instead that posts a reversing CREDIT to 'Advances to Employees' (mirroring the `-REPAY-` shape but with no bank tag) and sets the doc to a terminal status — preserving history rather than erasing it.

No firestore.rules change is needed; the president's delete right is intentional and the cascade is a client-side concern. Remember the repo rule: bump nothing by hand — the pre-commit hook handles APP_VERSION/CACHE_VER.

### F35 — Neither page dispatcher has an error boundary — real but near-inert defensive gap; the named Finance/BIR/Chat screens do NOT hang (their reads swallow errors at the source), and the "reproduction" stubbed away the very guard it claimed was missing

**What is true**

The structural half of the finding is true and I confirmed it directly. js/app.js:2366 paints `c.innerHTML = window.skeletonHtml(_skeletonKindFor(page))`, then the switch at :2377 calls every renderer fire-and-forget (`case 'personal-finance': renderPersonalFinance(currentUser, currentRole); break;`) with no `.catch` and no try/catch. js/screens/finance.js:339 `loadFinanceContent` does the same for the 17 Finance sub-tabs and is called un-awaited from renderFinanceNav (js/screens/finance.js:271 — the finding's line number is right). js/errlog.js:102 `window.onunhandledrejection` only calls `record(...)`; no toast, no UI. So there genuinely is no error boundary, and the codebase itself proves this is the intended pattern: js/screens/production.js:1114-1130 `loadProdContent` wraps its identical sub-tab switch in try/catch and paints "Couldn't load" + a working Retry button. Finance and navigateTo simply never got that treatment.

All three refuters are correct on the consequence, and I verified their key citations rather than trusting them. The claimed reproduction is invalid: the finder stubbed `BankAccounts.list` to reject, but js/config.js:826-827 is `const snap = await dbCachedGet('bank_accounts', () => db.collection('bank_accounts').get().catch(() => ({ docs: [] })), 300000);` — the fetcher cannot reject, and dbCachedGet (js/config.js:648-676) only rethrows when the fetcher rejects, so the shipped `BankAccounts.list` cannot produce the state that was demonstrated. Same for the flagship scenario: renderFinancialReports (js/screens/finance.js:583) reaches Firestore only through loadFinStatement (:515-518), which awaits `ledgerForPeriod`/`gjForPeriod` — both `.get().catch(() => ({docs:[]}))` at js/config.js:788-791 and :807-811. renderBankAccounts (:1448) awaits exactly those two guarded readers. renderBankRec's first await is literally `.catch(() => [])` (js/bir.js:1195). renderInventory (js/modules.js:72) paints its shell synchronously and delegates to renderStock, whose single read is `.catch(()=>({docs:[]}))` (js/modules.js:96). renderBalanceSheet/renderCashFlowReport/renderBIRTab write their shell before any await. The pervasive `.get().catch(() => ({docs:[]}))` convention IS this codebase's error boundary, applied at the read instead of the dispatcher.

What survives is a genuine but small residue, and it is broader than the single screen the refuters conceded. `dbCachedGet` rethrows on fetcher rejection (js/config.js:671 `throw err;`) and additionally installs a 4s negative-cache that rethrows the same error for every later caller of that key (:667). A grep for `dbCachedGet(` fetchers lacking `.catch` returns ~30 live call sites — including the president/manager branch of renderPersonalFinance (js/screens/dashboards.js:2192-2196: `users`/`tasks-all`/`kpi-evals`/`kpi-targets`, after painting `skeletonHtml('rows')` into `#pf-content` at :2187), js/screens/production.js:1141, js/screens/tasks.js:379, and every `dbCachedGet('users', ...)` site — the `users` key is force-swapped to `fetchUsersWithPayroll`, whose `db.collection('users').get()` at js/config.js:630 is unguarded. Any of those rejecting strands the skeleton exactly as described. But reachability is poor: firestore.rules:132 is `allow read: if isAuth()` for users, kpi_evals/kpi_targets/tasks are all permitted for the president/manager who reach that branch, none of the queries needs a composite index, and js/firebase-config.js:78 `db.enablePersistence({ synchronizeTabs: true })` makes offline collection reads resolve from IndexedDB instead of rejecting. So the trigger is essentially a transient `unavailable` on an admin-only screen — not "the President's P&L hangs forever".

Net: keep it as a low-severity defense-in-depth fix (the dispatcher boundary is cheap, has an in-repo precedent, and closes the whole class), not the high-impact outage that was reported. Separately worth noting for triage: the refuters surfaced the inverse defect on these same paths — a failed ledger read renders a complete, confident ₱0.00 P&L / Balance Sheet with working Print and CSV Export. That is a different and more serious finding than F35 and should be filed on its own; it is not what F35 claims.

**Fix**

Three edits, smallest first. Copy the existing in-repo pattern rather than inventing one.

1. js/screens/finance.js — `loadFinanceContent` (line 339). Wrap the whole `switch(sub)` body in try/catch, mirroring `loadProdContent` at js/screens/production.js:1114-1130 verbatim:
   `catch (e) { console.error('Finance load error', e); content.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load</h4><p>${escHtml(e.message||String(e))}</p><button type="button" class="btn-secondary btn-sm fin-retry-btn" style="margin-top:14px">Retry</button></div>`; if (window.lucide) lucide.createIcons({ nodes: [content] }); content.querySelector('.fin-retry-btn')?.addEventListener('click', () => loadFinanceContent(currentUser, currentRole, sub)); }`
   Every case already `await`s, so the catch sees all of them. No change needed at the :271 call site.

2. js/app.js — `navigateTo`, the switch at :2377. The cases are un-awaited sync calls to async functions, so a plain try/catch around the switch will not see the rejections. Add a module-local helper just above `navigateTo`:
   `function _pageFail(page, e) { console.error('Page load error', page, e); const c = document.getElementById('page-content'); if (!c) return; c.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load</h4><p>${escHtml(e && e.message || String(e))}</p><button type="button" class="btn-secondary btn-sm page-retry-btn" style="margin-top:14px">Retry</button></div>`; if (window.lucide) lucide.createIcons({ nodes: [c] }); c.querySelector('.page-retry-btn')?.addEventListener('click', () => navigateTo(page)); }`
   plus `function _dispatch(page, fn) { try { const r = fn(); if (r && typeof r.then === 'function') r.catch(e => _pageFail(page, e)); } catch (e) { _pageFail(page, e); } }`
   Then rewrite each case as `case 'personal-finance': _dispatch(page, () => renderPersonalFinance(currentUser, currentRole)); break;` etc. Also wrap the pre-switch `dept:` branch (js/app.js:2371 `renderDeptModule(dept)`) in `_dispatch(page, () => renderDeptModule(dept))` — it returns before the switch and has the same exposure.

3. Close the actual unguarded reads so the boundary is a backstop and not the primary handler. js/config.js:630 in `fetchUsersWithPayroll`: change `db.collection('users').get()` to `db.collection('users').get().catch(() => ({ docs: [], size: 0, empty: true }))` — this one line covers every `dbCachedGet('users', ...)` call site in chat.js, people.js, hr.js, tasks.js and dashboards.js at once. Then js/screens/dashboards.js:2194-2196: append `.catch(()=>({docs:[]}))` to the `tasks`, `kpi_evals` and `kpi_targets` fetchers, matching the employee branch at :2396-2404 which already does exactly this.

Bump nothing by hand — the pre-commit hook rewrites APP_VERSION and derives CACHE_VER. Do not fold the silent-₱0 reporting defect into this fix; file it separately.

### F37 — Payroll Save / Mark Verified render for 'secretary' but Firestore denies the write, and neither handler catches — the click is a silent no-op (dead button, no error toast)

**What is true**

The mechanism is real and I confirmed every construct in the current tree (line numbers in the finding are stale by ~76 in hr.js). firestore.rules:31 isMoneyAdmin() = president/manager/finance; payroll/{uid} create+update (firestore.rules:816) and pay_runs update (firestore.rules:892-895) both require it, with an explicit comment that this exists so 'secretary' cannot write. The client gate is broader: js/screens/hr.js:1422 renders the edit-emp-pay-btn with NO gate (its two immediate siblings at 1423/1424 ARE canFinance-gated), and js/screens/hr.js:2232 gates pr-verify-btn on canFinance = isFinancePriv() = canEditDept('Finance'), which returns true for 'secretary' (js/departments.js:17-27). Reach is real: js/app.js:18 maps secretary to the admin portal, js/screens/hr.js:351 explicitly whitelists secretary on the HR screen, and neither renderFinance nor renderPayrollHub nor renderPayrollManagement re-gates; reads (payroll, pay_runs, salary_history) are isFinanceOrAdmin(), which includes secretary, so the roster fully populates. Both writes are bare awaits (hr.js:1868 payroll.set, hr.js:2249 pay_runs.set) with no try/catch; window.busy (js/config.js:1868-1880) is try/finally and rethrows, and js/errlog.js:102 only writes error_log — no toast. So the click really does produce nothing visible.

The 'effect' lens refuted the CONSEQUENCE, and I follow it. It is right on every point I re-checked: closeModal() + Notifs.success('Payroll updated!') sit at hr.js:1988, AFTER the rejected await, so there is no false success; the in-memory roster patches (emp.allowance etc., hr.js:1960-1970) are also post-await, so the table never shows an unsaved number; the payroll.set is the FIRST write in the handler, so the denial happens before logAudit and before the payroll_ca_overrides write — no partial state. Peso delta is ₱0, the last authorized value survives, and the next Compute uses it. 'Payroll stalls at computed and the month's disbursement is blocked' is flatly false: pr-verify-btn renders and succeeds for president/manager/finance (they satisfy firestore.rules:893), and Disburse is president-only anyway (hr.js:2233, isRealPresident). I did NOT follow the code and reach lenses' 'high impact' framing — both explicitly scoped their verdicts to existence and reachability and disclaimed the impact question.

What remains is a genuine but low-severity dead-button/error-UX defect: the app shows an unauthorized user controls it will refuse, and refuses them without saying so. Two things make it worth fixing rather than dismissing: (1) the same screen already does it right twice — Compute (hr.js:2313-2338) and Disburse (hr.js:2278) both try/catch into Notifs.showToast, so this is an internal inconsistency, not a missing capability (js/departments.js:31-39 onClickSafe is the house primitive); (2) the hazard is already written down in the same file at hr.js:4691-4703 ('Mirroring the broader canFinance gate here would show secretary a button whose Save always fails server-side') and fixed in exactly one place, _payslipCanEdit(). Not a money bug, not a security bug — the server boundary holds correctly; the UI is merely broader than it.

**Fix**

Two edits, both in js/screens/hr.js, plus one optional hoist.

1) One money-tier client predicate that mirrors firestore.rules isMoneyAdmin(). Promote the existing private helper at js/screens/hr.js:4701 — `function _payslipCanEdit() { return ['president','manager','finance'].includes(window.currentRole); }` — to a shared `window.isMoneyAdminUI()` (define it near isFinancePriv in js/departments.js:27 so every screen can use it, keep _payslipCanEdit as a thin alias, and note it deliberately EXCLUDES 'secretary' and dept-only Finance members, unlike canEditDept('Finance')).

2) Gate the two controls with it instead of canFinance:
   - js/screens/hr.js:1422 — wrap the ✎ button the way its siblings on 1423/1424 already are: `${window.isMoneyAdminUI() ? `<button class="btn-secondary btn-sm edit-emp-pay-btn" ...>${emojiIcon('✎',16)}</button>` : ''}`. (Leave print-slip-btn alone — payslip printing is a legitimate secretary read.)
   - js/screens/hr.js:2232 — change `${(canFinance && state==='computed') ? ... id="pr-verify-btn" ...}` to `${(window.isMoneyAdminUI() && state==='computed') ? ... }`. Do NOT change `const canFinance` at hr.js:865 globally — it correctly governs read-ish/oversight UI elsewhere on the screen; only these money-write controls move to the narrower predicate.

3) Make the two handlers fail loudly regardless (defence in depth for stale pages / dept-Finance members / future role changes):
   - js/screens/hr.js:1863 — inside the `window.busy(...)` async callback, wrap the body from the `db.collection('payroll').doc(uid).set(...)` at 1868 through `loadPayrollTable(month)` at ~1989 in `try { ... } catch (err) { Notifs.showToast(err.message || 'Could not save payroll — you may not have permission.', 'error'); }` so the modal stays open WITH an explanation.
   - js/screens/hr.js:2242 — mirror the disburse handler 30 lines below (hr.js:2278): wrap the `pay_runs.doc(month).set({state:'verified',...})` at 2249 plus the logAudit/success lines in `try { ... } catch (err) { Notifs.showToast(err.message || 'Could not mark verified.', 'error'); }`.
   Either form is fine; using onClickSafe (js/departments.js:31) for pr-verify-btn is the more idiomatic option.

Optionally also gate `gen-payroll-btn` (js/screens/hr.js:928) on the same predicate for consistency — its handler already toasts on failure (hr.js:2334-2337), so it is correct-but-noisy today, not broken.

Per CLAUDE.md this is a JS edit, so let the pre-commit hook bump APP_VERSION / CACHE_VER; no firestore.rules change is needed — the rules are already correct and are what makes this harmless.

### F39 — check-ui-wiring.js uses a flat readdirSync and never scans js/screens/ — 13 live screen files (30,201 lines, 181 inline onclick) are outside the CI wiring guard, the same defect already documented as fixed in the sibling check-backup-coverage.js

**What is true**

The code claim is true and I reproduced it directly. scripts/check-ui-wiring.js:47-53 walks js/ with a flat fs.readdirSync, so it scans 25 files (js/*.js + index.html) and zero js/screens/*.js; the live run prints "scanned 25 files ... (info) getElementById/# lookups 390 ... PASS". All 13 screens are real production code (defer-loaded from index.html, in sw.js PRECACHE), 30,201 lines vs 27,554 scanned, with 181 inline onclick= sites the guard never reads. The guard is live in CI (.github/workflows/ci.yml:75-84, job `ui-wiring`) and is the only job covering UI wiring. The identical flat-readdir bug is documented and already fixed one file over in scripts/check-backup-coverage.js:67-79 ("a flat readdirSync used to silently miss anything nested ... the same day js/screens/*.js was introduced"), so this is a known class fixed in only one of two sibling scripts. My own scratch-copy recursive patch (repo tree untouched): 38 files, 1284 lookups, 1381 rendered ids, 0 hard failures, dangling lookups drop 2 -> 1.

The `effect` lens correctly refuted the finding's CONSEQUENCE, and I followed it. Its counterfactual holds: in the pre-fix tree (355976c^) js/screens/tasks.js:1131 renders id="create-task-btn" and :1179/:1197 look it up with document.getElementById — so it is not class (a), (b) or (c), and a gap-closed guard is provably silent on it. That bug was a duplicate-id / document-order runtime defect outside the guard's entire model. So "which is what happened" is false and IMPACT high is wrong. Two further deratings I confirmed myself: classes (a)/(b) are WARN-only and exit 0 (check-ui-wiring.js:19-25, 251-257), and the only blocking class (c) returns 0 with or without js/screens/ — so closing the gap changes no gate today (and per CLAUDE.md the Pages deploy is `git push` with no CI gate anyway). I also checked all 25 unbound-control warnings recursion surfaces and every one is a false positive from indirect lookup patterns the extractor does not model ($p('create-task-btn') in tasks.js, saveBtnId: 'save-tax-btn' passed as a variable in finance.js, _epModeOf('ep-sss-mode') helpers in hr.js) — recursion alone would make the guard warn on the CORRECT post-fix create-task code while it was silent on the broken one, i.e. inverted signal.

The `code` and `reach` lenses' STANDS verdicts are right about existence and liveness but neither tested the consequence, so they do not outweigh the effect lens on impact. Net: real, cheap, worth fixing as prospective coverage of dead onclick handlers in js/screens/ (the class the guard hard-fails on), not as an explanation of any shipped bug. Immaterial nit in the finding: the naive recursion scans 39 files, not 38, because it also swallows js/vendor/html2canvas.min.js (which inflates the window-global inventory with minified names and weakens class (c)); excluding vendor gives exactly 38.

**Fix**

Two-part edit, both in scripts/, no app code touched.

1. scripts/check-ui-wiring.js — replace the flat scan in `listSourceFiles()` (lines 47-57) with a recursive walk that skips vendor bundles, mirroring `collectJsFiles()` in scripts/check-backup-coverage.js:71-79:

  function listSourceFiles() {
    const files = [];
    const SKIP_DIRS = new Set(['vendor']);
    (function walk(dir) {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); }
        else if (e.name.endsWith('.js')) files.push(path.join(dir, e.name));
      }
    })(JS_DIR);
    const indexHtml = path.join(ROOT, 'index.html');
    if (fs.existsSync(indexHtml)) files.push(indexHtml);
    return files;
  }

Skipping js/vendor/ is load-bearing: without it html2canvas.min.js adds ~690 minified identifiers to `globalInventory`, which makes bogus onclick idents resolvable and silently degrades the one class that hard-fails.

2. Same file — teach the extractor the indirect-lookup patterns that dominate js/screens/, otherwise the recursion ships 23 pure-noise warnings and inverts the signal on correctly-fixed code. Cheapest correct version: in `extractAll()`, alongside GET_BY_ID_RE/QUERY_SELECTOR_ID_RE, add a "soft reference" set for class (b) only — any id string literal that appears anywhere in a .js source outside an id="..." attribute (e.g. /['"]([a-zA-Z0-9_-]+)['"]/ matches intersected with `definedIds`), and change the class-(b) filter at line 189 to `!referencedIds.has(t.id) && !softRefs.has(t.id)`. Leave classes (a) and (c) on the strict sets so the hard check keeps its precision. If a smaller change is preferred, extend GET_BY_ID_RE to also match the panel helper (`/(?:getElementById|\$p)\(\s*['"]([a-zA-Z0-9_-]+)['"]\s*\)/g`) and add the remaining ids (save-tax-btn, save-crj-btn, save-cdj-btn, save-rec-btn, rec-filter, ep-*-mode, hrp-stat-*-mode) to `unboundControls` in scripts/ui-wiring-allowlist.json with a one-line reason each.

Verify with `node scripts/check-ui-wiring.js`: expect "scanned 38 files" including the 13 screens, HARD 0, exit 0, and no new warnings beyond the pre-existing chat.js pair plus #cf-csv. Do NOT re-file the "Create task not working" bug against this guard — it is outside the guard's model; catching duplicate ids across simultaneously-mounted panels would be a separate check (e.g. flag any id literal rendered in two different template functions in the same file).

### F47 — System Health header excludes never-reported jobs from its "N of 8 need attention" count and colour, and renders the raw token "unknown" instead of a human label

**What is true**

The mechanical defect is real and present verbatim. js/screens/dashboards.js:151 maps a missing system_health/{jobId} doc to status 'unknown', and both the header badge colour and the count at :179-181 test only for 'error'||'stale' — so an all-missing collection renders a green "0 of 8 need attention". The secondary defect is also real: js/ui-status-meta.js:147-154 has no 'unknown' entry in the systemHealth table, so window.statusBadge2 (defined at :202, loaded via index.html) falls through to `label = raw` at :206 and prints the literal word "unknown" in badge-gray; the intended 'No data' label at dashboards.js:158 lives in a fallback branch that never executes.

The CONSEQUENCE, however, is wrong, and I follow the effect lens on this. (1) The scenario the finding leads with — a GitHub Action auto-disabled or a service account expiring — leaves the previously-written heartbeat doc in place, so status computes to 'stale' at :149-151, which IS counted and IS red. Only a job that has literally never written once yields 'unknown'. (2) For the two jobs the finding stakes its impact on, never-reported is independently alarmed: js/app.js:202 calls checkBackupHealth() on every sign-in for president/manager/secretary/finance, and :328 treats `!last` (exactly the missing-doc case) as a problem for daily_sync and monthly_backup, painting the fixed red "Records durability alert" banner (:356-366) and pushing Notifs.sendToOwner (:345). So "silent, indefinite loss of the monthly backup" does not happen. (3) I verified the writers myself: monthly-backup.js:554 writes monthly_backup_size_guard ONLY `if (sizeWarnings.length)`, and functions/index.js:1187/1201 write sendNotificationQuota only on a quota breach or in a catch block — for those two jobs an absent doc is the HEALTHY state, so the naive fix (count 'unknown' as needs-attention) would pin a permanent false red "2 of 8" on a clean system. The code and reach lenses both confirmed the lines but neither adjusted the severity for these.

What genuinely remains: the header contradicts its own rows (which correctly read "never" and gray), and the 4-6 non-critical jobs with no never-ran coverage anywhere (daily_digest, scheduledAttendanceReminder, scheduledDailyDigestChecks) can sit never-deployed behind a green header. That is a monitoring-summary accuracy bug on an internal screen where the per-row truth is visible right beside it — low, not high.

**Fix**

Per-job fix, not a blanket one.

1. js/app.js:372-381 (SYSTEM_HEALTH_JOBS) — add an `optional: true` flag to the two exception-only jobs whose absent doc means healthy: `monthly_backup_size_guard` (written only under `if (sizeWarnings.length)` at scripts/monthly-backup.js:554) and `sendNotificationQuota` (written only on quota breach at functions/index.js:1187 or in the catch at :1201). While there, note `executeApprovalOnUpdate` is a Firestore trigger that only heartbeats when a ca_deduct approval executes (functions/index.js:1093/1130), so its 36h staleMs already yields false 'stale' on a quiet week — either mark it optional or raise its staleMs; that is adjacent, decide separately.

2. js/screens/dashboards.js:151 — split the missing-doc case by that flag:
   `const status = !d ? (job.optional ? 'idle' : 'unknown') : errored ? 'error' : stale ? 'stale' : 'ok';`
   so "nothing to report" and "never reported" stop sharing one token.

3. js/screens/dashboards.js:179-181 — hoist a single predicate and use it for BOTH the badge class and the count so they can never drift:
   `const NEEDS_ATTN = new Set(['error','stale','unknown']);`
   then `<span class="badge ${jobs.some(j=>NEEDS_ATTN.has(j.status)) ? 'badge-red' : 'badge-green'}">` and `${jobs.filter(j=>NEEDS_ATTN.has(j.status)).length} of ${jobs.length} need attention`. 'idle' stays excluded.

4. js/ui-status-meta.js:147-154 — add the two missing rows to the `systemHealth:` registry so statusBadge2 stops printing the raw token:
   `{ id:'unknown', label:'Never reported', badge:'badge-orange' },`
   `{ id:'idle',    label:'No alerts',      badge:'badge-gray'   },`
   and update the dead fallback map at dashboards.js:158 to match ('unknown':'Never reported', 'idle':'No alerts') so the two paths agree if statusBadge2 is ever absent.

5. js/screens/dashboards.js:184 — extend the explanatory sentence to say that jobs which only report when something is wrong show "No alerts" when quiet, so the gray rows don't read as broken.

6. Optional cleanup spotted while verifying: functions/index.js:72 writes `system_health/sendPushOnNotification`, a doc id that is not in SYSTEM_HEALTH_JOBS, so that heartbeat is never surfaced on the screen. Add it as an `optional: true` entry or drop the write.

No firestore.rules change needed — firestore.rules:788-790 already allows the read for isFinanceOrAdmin(). Version/CACHE_VER bump is handled by the pre-commit hook.

---

## Refuted (3)

Kept on the record: knowing what was checked and dismissed is as useful as the
findings themselves, and stops the same claim being re-raised.

### F02 — Recording modals do hardcode a 'VAT-inclusive' default and never read the quote's vatIncluded — but the peso impact is zero and the proposed prefill would introduce a real tax error

The code lens is right that every quoted line exists (line numbers drifted: pickers are js/departments.js:2959 and :3248, auto-post :3073-3080, manual :3289-3338; `vatIncluded` is written to the quote doc at js/app.js:4484/:4557 and read zero times in departments.js). The reach lens is right that both forms are live, single-definition and nav-reachable. I followed the effect lens, which refuted the finding on both the consequence and the fix, and I verified its arithmetic myself.

(1) Zero money impact. js/money-core.js:37-49 — `vatSplit(a,'inclusive').recorded === a` and `vatSplit(a,'exempt').recorded === a`. The ledger's `amount` is byte-identical under either treatment, and `amount` is what every revenue/cash/AR/equity figure reads: js/bir.js:838 `totIncome = income.reduce((s,e)=>s+(e.amount||0),0)`, js/bir.js:857-858 cumIncome/cumExpense → derived retainedEarnings, js/departments.js project `amountCollected` increment. `net` is written into `extra` and consumed by nothing — I grepped `e.net`/`r.net`/`row.net` across js/ and the only hits are an unrelated local in js/bir.js:849 and a payroll KPI. So "revenue is understated by the same amount" is false; the delta is ₱0.00.

(2) No liability is booked. 'VAT Payable' exists only as a COA string (js/config.js:1931) with no writer anywhere. Nothing "must be remitted out of pocket" as a system consequence. The entire ₱53,571.43 lands in one place: computeVatSummary's outputVat/vatableSales (js/bir.js:76-84), feeding the 2550M/Q sheet whose own header (js/bir.js:9-11) states it is a worksheet for the accountant to transcribe, never a filing.

(3) The proposed fix is wrong and would be the worse error. `grep -in "exempt|zero-rated" quote-builder-v2.html` returns nothing — the quote builder has no VAT-exempt concept at all. `showVat` is a price-display flag: quote-builder-v2.html:3031 `vatAmt=showVat?net*vatRate:0` and :3057 renders "VAT exclusive" when false, i.e. "12% was not added to the quoted price", not "this sale is VAT-exempt". With BIRCONFIG.vatRegistered=true (js/bir.js:38), a VAT-registered seller's gross receipts are deemed VAT-inclusive, so 'inclusive' is the correct treatment on BOTH branches — mapping vatIncluded:false → 'exempt' would zero output VAT on a VATable sale (under-declaration), and → 'exclusive' would gross ₱500,000 up to ₱560,000, inventing cash (the foot-gun already guarded at js/departments.js:3294). 'inclusive' is also the system-wide posture: js/bir.js:80's legacy fallback imputes 12% on any income row with no vatAmount at all, and js/screens/design.js:443 hardcodes the same split.

What survives is a UX nit, not a defect: the treatment is a per-deal manual choice (helper text at js/departments.js:3254 says so explicitly), it is shown live in pesos before commit (js/departments.js:3260, :3272-3280), and the default is the conservative direction. Not worth a finding.

### F26 — Not a bug: the Designate dropdown IS filtered against the same array it appends to, so no code path can produce the duplicate assignee this finding requires

The finding's mechanism is real but its trigger does not exist, and the trigger is load-bearing — without a duplicate uid nothing ever collides.

MECHANISM (accurate, I confirmed it): functions/index.js:611-620 resolves every dedupKey'd entry to `ref.parent.doc(dedupDocId(notifData.dedupKey))` and batch.set()s them all in one db.batch(), with no dedupe by resolved target path; the batch.commit() sits inside a `while (items.length)` loop, so a throw kills every remaining chunk; and functions/index.js:1024-1030 is a single catch over one `toNotify` array that carries all six sections. Firestore does reject two writes to one doc in one commit (the vendored BulkWriter at functions/node_modules/@google-cloud/firestore/build/src/bulk-writer.js:860-862 splits batches for exactly this reason). So IF a collision occurred, the blast radius would be as described.

TRIGGER 1 — FALSE AS WRITTEN. The finding says js/screens/tasks.js:869 appends "with no membership check and no filtering of the 'Designate' dropdown." The dropdown is filtered, in the same function, 58 lines above the write: js/screens/tasks.js:812 `...filter(e=>!t.assignedTo.includes(e.id))` populates `#reassign-sel`, and the write at :870 `assignedTo:[...t.assignedTo,newUid]` spreads that identical `t.assignedTo` (a fresh server read at :641, never reassigned), so `newUid ∉ t.assignedTo` by construction. Double-clicking Designate writes the same array twice — idempotent, not additive. I checked git history because a legacy-data duplicate would still be fatal: `git log -S` shows the filter and the append were introduced in the SAME commit (1297a99 "v6") and I read that revision (js/departments.js:334) — the filter was there from day one. There is no historical window in which this path could have produced a duplicate.

Every other writer of `tasks.assignedTo` also dedupes: tasks.js:1072 and :1204 both `return` on `.some(a=>a.uid===uid)` (feeding :1096 and :1231), tasks.js:1056 filters the edit-modal option list too, and design.js:1271 guards `if (uid && !picks.some(...))` (feeding :1225). A repo-wide grep for `assignedTo *:` across js/scripts/functions returns no other array writer — govit.js:427/458/824 write plain strings on it_assets/it_tickets.

TRIGGER 2 — IMPOSSIBLE. §4 keys `gov-deadline-${bid.id}-...` over GOV_COLLECTIONS = ['gov_philgeps','gov_active_bids'] (functions/index.js:835). A bucket move at js/departments.js:4515-4517 does `const newRef = db.collection(targetCol).doc(); batch.set(newRef,...); batch.delete(...)` — brand-new auto-id, source deleted in the same batch — so one bid.id cannot exist in both.

I also swept the sections the refuters didn't: §2 lowstock-${doc.id}, §3 aec-fu-${doc.id}, §5 quote-fu-${doc.id}, §6 ar-aging-${doc.id} each push at most once per doc of a single `users` snapshot, and §1's two passes key on `deadline-tmrw-` vs `deadline-today-` from mutually exclusive `dueDate ==` queries. No cross-section key collision exists either.

LENSES: I followed code and reach — both read the actual file and found it does not say what the finding claims, and I re-verified tasks.js:812/:870, the v6 revision, departments.js:4515 and all six digest sections independently. I did not follow effect: it validated the failure chain downstream of the duplicate but never tested whether a duplicate can occur, which is the finding's own stated premise. A correct blast-radius analysis of an unreachable precondition does not make the finding stand.

WHAT SURVIVES (not this finding, no fix owed here): (a) an optional one-line hardening — dedupe `assignees` in pushTaskNotifs (functions/index.js:728) via `[...new Set(...)]`, or key commitInChunks' batch by resolved path — insurance against hand-edited/imported data only; (b) a genuinely real but DIFFERENT defect at tasks.js:870, which overwrites the whole array from a panel-open snapshot instead of using arrayUnion, so a concurrent admin's added assignee is silently dropped (lost update, never a duplicate). That deserves its own finding.

### F62 — `?portal=partner` is a client-side chrome switch (true), but dropping it discloses no cost/margin/day-rate data and grants no write — firestore.rules already is the boundary

MECHANISM: confirmed exactly as written (the `code` lens is right on every construct, only line numbers drifted ~+50). quote-builder-v2.html:1743 `const PARTNER_MODE = new URLSearchParams(location.search).get('portal') === 'partner';`, :1760 `function applyPartnerMode(){ if(!PARTNER_MODE) return;` is pure DOM mutation, called once at :1814, with no role/auth/frame check anywhere in the file. js/app.js:1793 appends the param. A partner can absolutely open the frame in a new tab and delete the query string.

CONSEQUENCE: refuted. I re-derived it rather than trusting the votes, and the `reach` and `effect` lenses are correct — this is a UI-layer finding whose own demanded remedy ("protection has to live in firestore.rules") is already shipped, so the rules boundary genuinely refutes it. Item by item, for each thing dropping the param restores:

1. Cost & Margin panel — renders ZEROS. firestore.rules:1147-1149 `match /product_costs/{docId} { allow read, write: if isAuth() && !isPartner() && (isAdmin() || canFinance()); }`. Every session app.js routes into partner mode fails this: role 'partner' fails `!isPartner()`; an `isBrilliantOnly()` employee (js/app.js:1324, dept-only test) fails `isAdmin() || canFinance()`. Dropping the param sends quote-builder-v2.html:1640 down the non-partner branch, the read throws PERMISSION_DENIED, it is swallowed at :1643-1645, costMap stays `{}`, and :1666-1667 fall back to `p.capitalMaterials ?? 0`. Note the panel already computes from that same fallback for a Brilliant Steel partner WITH the param, so the numbers are identical either way — the param changes nothing about what cost data reaches the session.

2. Labor & Timeline day rates — not secret. loadDatabase fetches `productMeta/config` UNCONDITIONALLY (:1622), rules:1137-1138 `allow read: if isAuth();`, and `DB.laborRoles` is populated in partner mode too — applyPartnerMode only does `lt.style.display='none'` (:1782). The fallback rates are literally hardcoded in this static, publicly-served GitHub-Pages file at :4828-4834 (Foreman ₱1500/day, Sr. Welder ₱1200, …), readable by anyone on the internet with no login at all.

3. Admin view — its only Firestore write is :3676 `db.collection('products').doc(id).set(...)`, denied by rules:1130-1134 (`isAdmin() && productCostFieldsLocked()`); the catch surfaces the failure to the user. Everything else it touches is the in-memory DB + localStorage, which self-corrects on reload. Product *reads* are `allow read: if isAuth()` (rules:1128) with or without the param.

4. Internal panel contents — I read :1256-1300: it is exactly Labor/Timeline + Cost/Margin, nothing else. No discount authority, no approval bypass.

RESIDUALS (both real, both outside what F62 claims, neither high):
(a) The CO.BI "Barro Industries" pill (:707) and the `PARTNER_BLOCKED_COS` state lock at :1879 both go away with the param, so a partner could PRINT/PDF a quote on the parent company's letterhead. Filing is still denied — rules:1005-1016 exclude partners from bk_quotes absolutely — so this is brand impersonation in an exported PDF only. Worth a separate low note.
(b) If `migrateProductCostsOut()` (js/migrations.js:417) has not been run against every product in prod, legacy `products` docs still carry capitalMaterials/capitalLabor and firestore.rules:1128 `allow read: if isAuth();` hands them to any signed-in partner — from the browser console, with or without `?portal=partner`. That is a genuine `products`-read exposure and deserves its own finding; it is not a defect in the query-parameter gate and no edit to applyPartnerMode() would close it.

The finding as filed (IMPACT: high, "exposes Barro's cost basis, margin and internal day rates") does not hold.
