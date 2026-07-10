# Workstream 22 — Cash-Advance Installments in Payroll (ONE CashAdvance service)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

SCOPE CORRECTION: what the owner's prompt calls "three approval paths" is actually FOUR write sites that set a cash_advances doc to status:'approved', plus a fifth, entirely parallel CA-like system for hourly workers that never touches the cash_advances collection. Verified against v12 HEAD, clean working tree, so all line numbers are current.

== REQUEST-CREATION PATHS (two, materially different doc shapes) ==

1. js/modules.js:1580-1657 openCashAdvanceModal() — the Cash Advance tab's employee-facing request form (reached via window.renderCashAdvancePage -> renderCashAdvanceEmployee, non-admin roles). Computes real installment math client-side with a hardcoded rate the EMPLOYEE can opt in/out of via a checkbox (id="ca-interest-on"):
```js
const RATE = 2; // 2% per month interest
...
const total   = interestOn ? amt * Math.pow(1 + RATE/100, terms) : amt;
const monthly = total / terms;
```
Write on submit (modules.js:1635-1651):
```js
await db.collection('cash_advances').add({
  userId, userName, employeeId, amount: amt, terms,
  interest: interestOn ? RATE : 0, interestCharged: interestOn,
  totalPayable: Math.round(total*100)/100, monthlyPayment: Math.round(monthly*100)/100,
  balance: 0, date, reason, status: 'pending', payments: [], createdAt: serverTimestamp()
});
```
balance is explicitly 0 at creation — real balance is assigned only on approval.

2. js/app.js:4524-4548 — a SECOND, independent request form on the Personal Finance page (renderPersonalFinance, button id="req-advance-btn"). No terms, no interest, no monthlyPayment, no totalPayable, and **no balance field at all**:
```js
await db.collection('cash_advances').add({
  userId: currentUser.uid, userName: name, employeeId: currentUser.uid,
  amount, date: document.getElementById('ca-date').value,
  repayDate: document.getElementById('ca-repay').value,
  reason: document.getElementById('ca-reason').value.trim(),
  status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp()
});
```
This is a LIVE BUG (see risks): firestore.rules requires `balance == 0` on create for a self-filed request, and an absent field throws/denies per the project's own "missing-field throws" rules pattern, so this create is likely rejected outright today.

3. js/modules.js:1664-1745 openPresidentCashAdvanceModal(users) — president-only "Record Cash Advance for Employee," pre-approved at creation (status:'approved' immediately, no pending state). President types amount + monthlyPayment + terms directly; totalPayable = monthly*terms (falls back to amount), balance = totalPayable. No interest field exposed (baked into monthly). Has a `private` flag (visible only to president/finance) not present on the other two creation paths.

== FOUR PATHS THAT SET status:'approved' (and disagree on resulting balance) ==

A. js/modules.js:1467-1503 (ca-approve-btn in renderCAList — used by BOTH the employee-visible admin view and the Finance/President/Manager admin view of the SAME page). Runs inside a `db.runTransaction` (re-checks status==='pending' to prevent double-approve), and is the only path with race protection:
```js
t.update(ref, {
  status: 'approved', approvedBy, approvedAt: serverTimestamp(),
  // Repayable balance = Total Payable (principal + interest when charged),
  // falling back to principal for legacy records / interest-free advances.
  balance: (a.totalPayable != null ? a.totalPayable : a.amount)
});
```

B. js/departments.js:3506-3508 (renderFinanceCA — the Finance department's own "Cash Advances" tab, gated by isFinancePriv() = canEditDept('Finance')):
```js
const {id,uid,name,amount} = e.currentTarget.dataset; // "amount" = the raw request amount
await db.collection('cash_advances').doc(id).update({status:'approved', balance:parseFloat(amount), approvedAt:..., approvedBy:...});
```
No transaction guard (no re-read/status check), and — critically — sets balance to the raw `amount`, IGNORING totalPayable/interest entirely. For an interest-bearing request from path 1 above, this under-collects vs. path A.

C. js/departments.js:9367-9369 (Approvals page, "All Requests" aggregated tab, ca-approve-btn):
```js
await db.collection('cash_advances').doc(id).update({ status:'approved', balance:parseFloat(btn.dataset.amount)||0, approvedBy, approvedAt });
```
Same bug as B (uses raw amount, ignores totalPayable). No transaction guard.

D. js/departments.js:9989-9993 (Approvals page, dedicated "Cash Advances" chip/subtab, `if (sub === 'ca')` block starting departments.js:9958):
```js
await db.collection('cash_advances').doc(id).update({ status:'approved', approvedAt: serverTimestamp() });
```
Sets status to approved but **never sets balance at all** — whatever balance the doc had at creation (0 from path-1 requests, or `undefined` from the path-2 request form) is left untouched. Combined with path-2's missing balance field, an approval through this exact tab for a request filed through the Personal-Finance form leaves balance permanently undefined, which every downstream balance filter (`(a.balance||0)>0`) treats as zero — the CA is "approved" but invisible to the employee's outstanding total (app.js:4219) AND to payroll's CA deduction (departments.js:2409, see below).

AUTHORIZATION ALSO DISAGREES ACROSS THESE FOUR SURFACES: (1)/(A) gate on role in {president, manager, finance}; (B) gates on Finance-department membership (canEditDept, independent of role); (C)/(D) gate on APPROVAL_CAPS.ca = {president, manager} ONLY — a pure 'finance'-role user (no Finance dept membership) can approve via surface 1 but not via C/D. firestore.rules' own isFinanceOrAdmin() (line 22) additionally includes 'secretary', broader than any of the four UI gates — the UI (departments.js:9133-9145, comment at 9127-9132) deliberately excludes secretary from 'ca' (money-moving tier reserved for President), but rules would technically permit a secretary-authenticated write via console/API. This is the exact class of gap workstream 19 ("secretary rules limited to true minor-approvals tier") is meant to close — flag the interaction.

Rejection is comparatively consistent: modules.js:1505-1514, departments.js:3513-3519, departments.js:9373-9376, departments.js:9998-10006 — all four just `.update({status:'rejected'})` (C/D also stamp rejectedBy/rejectedAt; B/modules.js don't).

== PAYMENT-RECORDING PATHS (two, both correct on decrement math, neither transactional in one case) ==

- js/modules.js:1516-1568 (Cash Advance tab "Record Payment"): wrapped in `db.runTransaction`, re-reads balance/status, computes `newBal = Math.max(0, cur.balance - paid)`, appends to `payments[]`, flips status to 'paid' at newBal<=0.
- js/departments.js:3520-3539 (Finance CA tab "Record Payment" — fin-ca-pay): same math, NOT transactional (plain get+update, no re-read guard against a concurrent double-click/second admin).

Both allow an admin-entered "Amount Paid" that defaults to `monthlyPayment` but is freely editable up to `balance` — i.e., manual, ad-hoc payment recording is already independent of any monthly-installment automation; it's a separate flow from the payroll-driven deduction below.

== PAYROLL COMPUTE — CA DEDUCTION LOGIC (the actual _caByUser/_caOverrideByUser you asked to ground) ==

Lives inside `renderPayrollManagement` (js/departments.js:2128 onward), for REGULAR/monthly-salaried employees only (payClass !== 'production'). Shared closure state declared once (departments.js:2394):
```js
let _caByUser = {}, _caDocsByUser = {}, _caOverrideByUser = {};
```

Populated at the top of `loadPayrollTable(month)` (departments.js:2396-2418), re-run every time the payroll table (re)loads for a given month:
```js
const [caSnap, overrideSnap] = await Promise.all([
  db.collection('cash_advances').where('status','==','approved').get().catch(()=>({docs:[]})),
  db.collection('payroll_ca_overrides').where('month','==',month).get().catch(()=>({docs:[]}))
]);
_caByUser = {}; _caDocsByUser = {};
caSnap.docs.forEach(d => {
  const a = d.data();
  _caByUser[a.userId] = (_caByUser[a.userId]||0) + (a.balance||0);
  (_caDocsByUser[a.userId] = _caDocsByUser[a.userId]||[]).push({id:d.id,...a});
});
_caOverrideByUser = {};
overrideSnap.docs.forEach(d => {
  const o = d.data();
  _caOverrideByUser[o.userId] = { amount: o.amount, docId: d.id };
});
```
Notes: `_caByUser` sums ALL approved advances' balance for a user (a user can have multiple concurrent CAs; they're pooled into one deduction amount). `_caDocsByUser` keeps the individual docs for later per-doc FIFO decrementing.

DEFAULT-IS-FULL-BALANCE, confirmed at three call sites that all use the identical ternary pattern (table preview departments.js:2429-2431, Compute-time salary_history write departments.js:2632-2634, Compute-time ledger amount departments.js:2673, Compute-time pay_runs net total departments.js:2757):
```js
const caBalance   = _caByUser[u.id]||0;
const hasOverride = _caOverrideByUser[u.id] !== undefined;
const caAdv       = hasOverride ? _caOverrideByUser[u.id].amount : caBalance;
```
i.e. absent an explicit `payroll_ca_overrides/{uid}_{month}` doc for this run, the deduction IS the full outstanding balance across all of that employee's approved CAs — confirmed default is "full balance," not "this installment."

The exact "Leave blank = deduct full" UI string (departments.js:2517-2525, inside the per-employee "Edit Payroll" modal, `edit-emp-pay-btn`):
```js
${caBalance > 0 ? `
<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
  <label style="font-weight:600">💳 Cash Advance Deduction This Month</label>
  <div style="font-size:12px;color:var(--text-muted);margin:4px 0 8px">Outstanding balance: <strong>₱${fmt(caBalance)}</strong></div>
  <input id="ep-ca-deduct" type="number" min="0" max="${caBalance}" step="0.01"
    value="${caOverride}"
    placeholder="Leave blank = deduct full ₱${fmt(caBalance)}" inputmode="decimal"/>
  <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Enter a partial amount to defer the rest to next month. Clear field to revert to full balance.</div>
</div>` : ''}
```
Save handler (departments.js:2544-2555) writes/deletes `payroll_ca_overrides/{uid}_{month}` doc (`{userId, month, amount, setBy, setAt}`) — clearing the field deletes the override doc, reverting to full-balance default next load. There is a mirror, EMPLOYEE-initiated override request at js/app.js:4550-4600+ (button id="ca-deduct-req-btn" on Personal Finance) that writes to the SAME `payroll_ca_overrides` collection with the SAME doc id scheme (`{uid}_{month}`) — the string "If left at full balance, the full amount will be deducted." lives at app.js:4564. Whether this employee-initiated doc is a genuine request needing finance sign-off, or takes effect unmediated the same as the finance-typed override, is one of the open decisions below (firestore.rules currently makes `payroll_ca_overrides` write finance/admin-only at line 308, so as written the employee's write would be rejected by rules unless there is a separate approval hop not evident in this file — verify).

THE ACTUAL DEDUCTION (Compute step, "Compute Payroll" button, departments.js:2715-2750), gated so it only runs on first-generation for a month (non-idempotent, unlike the salary_history/ledger writes around it which ARE idempotent upserts):
```js
if (!alreadyGenerated) for (const u of employees) {
  const caBalance = _caByUser[u.id]||0;
  if (caBalance <= 0) continue;
  const hasOvr    = _caOverrideByUser[u.id] !== undefined;
  const deductAmt = hasOvr ? _caOverrideByUser[u.id].amount : caBalance;
  if (deductAmt <= 0) continue;

  let remaining = deductAmt;
  const caDocs  = _caDocsByUser[u.id] || [];
  const caBatch = db.batch();
  const caDeductions = []; // per-advance split, stored so a payroll delete can reverse it
  for (const caDoc of caDocs) {
    if (remaining <= 0) break;
    const docBal   = caDoc.balance||0;
    const toDeduct = Math.min(docBal, remaining);
    const newBal   = Math.max(0, docBal - toDeduct);
    caBatch.update(db.collection('cash_advances').doc(caDoc.id), {
      balance: newBal,
      ...(newBal <= 0 ? { status:'paid', paidAt: serverTimestamp() } : {})
    });
    if (toDeduct > 0) caDeductions.push({ caId: caDoc.id, amount: toDeduct });
    remaining -= toDeduct;
  }
  await caBatch.commit();
  if (caDeductions.length) await db.collection('salary_history').doc(`${u.id}_${month}`)
    .set({ caDeductions }, { merge:true }).catch(()=>{});
  await Notifs.send(u.id, { title:'💳 Cash Advance Deducted from Payroll', body:`₱${fmt(deductAmt)} was deducted...`, icon:'💳', type:'cash_advance' });
}
```
Order of multi-CA decrement is doc-array order from `_caDocsByUser` (not sorted by date/priority — worth flagging). `caDeductions` (the per-advance split) is written onto the frozen `salary_history/{uid}_{month}` doc specifically so `financeDeleteCascade` (departments.js:141-160) can reverse it if that payroll record is later deleted:
```js
if (Array.isArray(d.caDeductions)) {
  for (const cd of d.caDeductions) {
    if (cd && cd.caId && cd.amount > 0) {
      await db.collection('cash_advances').doc(cd.caId).update({
        balance: firebase.firestore.FieldValue.increment(cd.amount),
        status: 'active', paidAt: firebase.firestore.FieldValue.delete()
      }).catch(()=>{});
    }
  }
}
```
NOTE the status value here is `'active'` — every other place in the codebase uses `'approved'` for an outstanding CA with balance>0 (`'active'` is not a recognized status anywhere else: every filter checks `status==='approved'`). This looks like a latent bug: reversing a payroll deletion currently mislabels the CA's status such that it may stop showing up as an active/approved balance in every UI that filters strictly on `status==='approved'`.

Nowhere in this Compute flow (or anywhere in the codebase — grepped for "installment") is an "installment N of terms" indicator computed or displayed. The employee-facing CA card (modules.js:1355-1368) shows `payments.length` as "N payment(s) recorded" but never cross-references `a.terms` to phrase it as "installment N of M." This is a pure gap, not a conflicting implementation — building it means correlating `payments.length` (or a payroll-driven equivalent) against `a.terms`.

== THE SEPARATE PARALLEL SYSTEM: hourly "production" workers (payslips / worker_profiles) — NOT in scope by collection but likely in scope by product intent ==

departments.js:2495-2502 explicitly branches pay logic by `payClass`: "Regular — monthly (KPI + attendance)" uses the `cash_advances` machinery above; "Production — weekly, fixed rate" is paid via an entirely separate `openPayslipGenerator`/`payslips` collection flow that has its OWN, unconnected cash-advance concept: a single running number `worker_profiles/{id}.caBalance`, hand-typed in the HR profile editor (departments.js:3736, "Cash Advance Balance (₱)" field, saved at departments.js:3771) with NO request/approval workflow of any kind — no `cash_advances` doc is ever created for a worker loan. The weekly payslip generator (departments.js:4060-4126) lets HR type an arbitrary "Cash Advance Deduction" amount **defaulting to 0** (not full balance — the opposite default from the salaried-employee flow) against `profile.caBalance`, and on save decrements it directly (departments.js:4196-4197, 4143):
```js
const caBalanceBefore = profile.caBalance || 0;
const caBalanceAfter  = Math.max(0, caBalanceBefore - ca);
...
await db.collection('worker_profiles').doc(profile.id).update({ caBalance: d.caBalanceAfter });
```
Editing a filed payslip afterward reconciles the delta manually (departments.js:3972-3976). This is a materially different data model (single scalar vs. document collection with status/terms/payments) and a different default (0 vs full-balance). Whether "ONE CashAdvance service" is meant to unify these two employee populations (salaried monthly + hourly weekly) or explicitly exclude worker_profiles from this workstream's scope is an open decision below — the owner's phrasing ("all 3 surfaces... disagree on interest") suggests scope was meant to be the cash_advances collection only, but the worker_profiles system is a live sibling that will confuse anyone implementing a single shared service if not explicitly scoped out.

== FIRESTORE RULES (firestore.rules:169-192, 303-309) ==
```
match /cash_advances/{docId} {
  allow read: if isAuth() && (resource.data.userId == request.auth.uid || isFinanceOrAdmin());
  allow create: if isAuth() && (
    isFinanceOrAdmin() ||
    (request.resource.data.userId == request.auth.uid
      && request.resource.data.status == 'pending'
      && request.resource.data.balance == 0)
  );
  allow update: if isAuth() && (
    isFinanceOrAdmin() ||
    (resource.data.userId == request.auth.uid
      && request.resource.data.status  == resource.data.status
      && request.resource.data.balance == resource.data.balance
      && request.resource.data.amount  == resource.data.amount)
  );
  allow delete: if isAuth() && isPresident();
}
match /payroll_ca_overrides/{docId} {
  allow read: if isAuth() && (resource.data.userId == request.auth.uid || isFinanceOrAdmin());
  allow write: if isAuth() && isFinanceOrAdmin();
}
```
`isFinanceOrAdmin()` = role in [president, manager, secretary, finance] (firestore.rules:22). This is the rule that almost certainly rejects the app.js:4524-4548 self-request (missing `balance` field — per this repo's own documented Firestore-rules gotcha, reading an absent field in a rule denies the rule, i.e. `request.resource.data.balance == 0` throws/denies when `balance` was never set on the doc being created). `payroll_ca_overrides` is write-gated to finance/admin only, which appears to conflict with app.js's employee-initiated "Set Deduction" button writing directly to that same collection (see open decision below — verify whether that write actually succeeds today, or silently fails, for a plain 'employee' role).

## Data model

cash_advances/{docId} (top-level collection, NOT a subcollection of users) — fields observed across all writers:
- userId (string, uid) — owner
- userName, employeeId (strings, denormalized at creation, never re-synced if the user's name changes later)
- amount (number) — original requested/principal amount
- terms (number, months) — present on modules.js-created docs only; absent on app.js-created docs
- interest (number, percent/month) / interestCharged (bool) — present on modules.js path only; openPresidentCashAdvanceModal hardcodes interest:0 (bakes interest into monthlyPayment instead)
- monthlyPayment (number) — the nominal per-month installment; present on both modules.js paths, absent on app.js path
- totalPayable (number) — principal+interest total to be repaid; present on modules.js paths only
- balance (number) — THE field payroll deduction reads; semantics disagree across writers (see currentState: sometimes = totalPayable, sometimes = raw amount, sometimes left undefined)
- date (string, ISO, "date needed") 
- repayDate (string, ISO) — app.js path only, unused elsewhere
- reason (string, free text, user-supplied — must be escHtml()'d on render, is consistently escaped in read paths seen)
- status (string enum, values actually used: 'pending' | 'approved' | 'rejected' | 'paid'; ALSO 'active' written once by financeDeleteCascade — inconsistent with the rest of the codebase, likely a bug)
- payments (array of {amount, date, recordedBy} — no payment id/timestamp-as-serverTimestamp, `date` is a plain string not a Firestore Timestamp)
- private (bool) — only set by openPresidentCashAdvanceModal; gates visibility to president/finance vs everyone in renderCashAdvanceAdmin (modules.js:1387-1392)
- addedBy / approvedBy / approvedAt / rejectedBy / rejectedAt / lastPaymentAt / paidAt — audit stamps, inconsistently present depending on which of the 4 approval paths touched the doc
- createdAt (Firestore serverTimestamp)

payroll_ca_overrides/{uid}_{month} — deterministic composite doc id (not auto-id):
- userId, month ("YYYY-MM" Manila), amount (number — the this-month override deduction), setBy, setAt

salary_history/{uid}_{month} — the frozen per-employee-per-month payroll snapshot (deterministic id):
- userId, userName, month, salary, allowance, deductions, sss, philHealth, pagIbig, tax
- caDeducted (number) — the ACTUAL amount deducted this run (= caAdv at Compute time)
- netPay, finalPay, recordedBy, recordedAt
- caDeductions (array of {caId, amount} — added post-hoc, only when a CA deduction actually happened, merged in after the main batch.set) — this is the reversal manifest read by financeDeleteCascade

pay_runs/{month} (doc id = "YYYY-MM") — governance-only state machine, no raw pay figures beyond aggregate net:
- state ('draft'|'computed'|'verified'|'disbursed'), employeeCount, totalNet
- computedBy/computedByName/computedAt, verifiedBy/..., disbursedBy/...

ledger/{autoId} — one row per employee per pay run, refNumber = `PAY-{month}-{uid}` (deterministic-by-convention, looked up not stored as doc id), amount = post-CA-deduction net (empNet = base+allow-deduct-caAdv), category 'Payroll Expense'.

worker_profiles/{id} (SEPARATE population — hourly "production" workers):
- caBalance (number) — single running scalar, no history/terms/status; hand-edited in HR profile form and directly decremented by the weekly payslip generator. Does NOT create or reference any cash_advances doc.

payslips/{id} (weekly worker payslips, separate from salary_history):
- deductions.other.cashAdvance (number) — the amount deducted THIS payslip against worker_profiles.caBalance
- workerId (fk to worker_profiles), payPeriodStart/End, status, etc.

Users read via `employees` array already loaded into renderPayrollManagement's closure (users collection fields salary/allowance/deductions/sss/philhealth/pagibig/tax/payClass — separately, "protected" pay fields actually live in payroll/{uid} per the project's documented payroll-collection-architecture convention, merged into the `emp` objects before this code runs; not re-verified line-by-line here since it's outside this workstream's edit surface, but the Edit-Payroll-modal save at departments.js:2531-2540 writes to `payroll/{uid}`, confirming the split).

## Constraints — must respect

- Manila-time discipline: any date/month math in this workstream (pay-period month, override doc id `{uid}_{month}`, "this month's installment" cutover) must derive from window.bizDate()/bizDate().slice(0,7), never new Date()/toISOString() — see departments.js:2577 and app.js:4552 already doing this correctly; do not regress.
- escHtml() discipline: userName/reason/employeeId are rendered raw in several existing call sites via template strings (e.g. modules.js:1430 `escHtml(a.userName)`, departments.js:3485 `escHtml(a.userName||'Unknown')`) — new UI must escHtml() every user-supplied string before innerHTML, matching the existing pattern; do not introduce a new unescaped render path.
- Idempotency: the Compute-time CA balance decrement (departments.js:2715-2750) is explicitly gated `if (!alreadyGenerated)` because balance writes are NOT safely re-runnable, unlike the salary_history/ledger upserts beside it which ARE keyed/idempotent. Any redesign of this deduction step must preserve (or explicitly re-derive) a not-already-deducted guard, or a re-run of Compute will double-deduct a real loan balance.
- Firestore rules coverage is per-collection with no cascade/prefix matching (project convention, confirmed in firestore.rules:169-192 and 303-309) — any new collection this workstream introduces (e.g. a normalized `ca_installments` or `ca_ledger` subcollection) needs its own explicit `match` block, and the existing missing-field-throws gotcha (rules deny on an absent field, not just a mismatched one) must be accounted for if the new CashAdvance service's create/update payload shape changes (the current create rule's `balance == 0` check is the likely cause of the app.js:4524 write failing today — a payload-shape change must not introduce a similar silent-deny elsewhere).
- Load order / global-function convention: departments.js loads after config.js/drive.js/notifications.js and before app.js's dependents per index.html's fixed defer order (see CLAUDE.md) — a new shared `window.CashAdvance` service must be defined in a file that loads before every caller (modules.js, departments.js, app.js all reference cash_advances; app.js is loaded LAST per CLAUDE.md's documented order — firebase-config.js -> config.js -> drive.js -> notifications.js -> departments.js -> app.js -> modules.js; note modules.js loads AFTER app.js despite app.js containing its own inline CA request form, so a shared service should probably live in config.js or a new early-loaded file, not inside departments.js or modules.js themselves, so all three existing call sites can adopt it without reordering the script tags).
- CACHE_VER bump: any edit to js/app.js, js/departments.js, js/modules.js, or js/config.js under this workstream requires bumping CACHE_VER in sw.js (currently 'bi-ops-v162') per CLAUDE.md — handled automatically by the pre-commit hook per repo convention, do not hand-edit.
- dbCacheInvalidate discipline: every existing CA mutation site calls dbCacheInvalidate('ca-pending') (e.g. modules.js:1252, departments.js:9233-9234, app.js:4543) to keep the dashboard's cached pending-count badges (app.js:2246,2461,2572,2683 all key off 'ca-pending' with a 30s TTL) from showing stale counts — a unified service must keep invalidating this same cache key (and any new key it introduces) on every write.
- Transactional integrity is inconsistent today and should be treated as a floor, not a ceiling: only 2 of the 4 approve-paths and 1 of the 2 payment-record paths currently use db.runTransaction with a re-read + status guard (modules.js:1479-1493, modules.js:1538-1551); a unified service should be at least as safe as the safest existing path, not regress to the unguarded plain .update() pattern used by departments.js:3508/9368/9992.

## DECIDED — architecture spec (Fable, 2026-07-10)

### Resolved decisions (one-line ruling + rationale each)

1. **Single writer: `window.CashAdvance` in js/config.js.** All 4 approval surfaces, both
   payment surfaces, and payroll call it; config.js loads before every caller (modules.js loads
   LAST — the service cannot live there). UI surfaces are NOT deleted in this workstream (screen
   consolidation belongs to the roles/declutter work) — they become thin callers.
2. **Approved balance = `totalPayable ?? amount`, computed only inside `.approve()`** (in a
   transaction), with the exact figure shown in the approver's confirm dialog
   ("Approve — employee repays ₱23,447 (₱20,000 + 2%/mo × 8 mo)?"). Paths B/C's raw-`amount`
   under-collection and path D's balance-never-set bug are closed by construction.
3. **Interest is an approval-time decision, not an employee checkbox.** The request form drops
   the interest toggle; the approver sees terms + an editable interest field (pre-filled 2%/mo,
   editable down to 0). **FLAG FOR NEIL:** the default interest policy (2% vs 0) is a business
   call — spec pre-fills 2% but nothing charges until an approver confirms.
4. **One request form.** modules.js's structured form (amount, terms, reason, date-needed —
   minus the interest checkbox) becomes `CashAdvance.openRequestForm()`; the Personal-Finance
   "+ Cash Advance" button calls it; the app.js:4524-4548 form is DELETED (it is dead today —
   its create omits `balance`, which the rules' `balance == 0` check denies). `repayDate` is
   dropped (terms replaces it); the Approvals 'ca' display swaps its repayDate line for
   "`terms` mo plan · ₱`monthlyPayment`/mo".
5. **worker_profiles: separate data model, same service.** No migration of worker CA scalars
   into cash_advances (that forces an identity-model project). The service gains
   `CashAdvance.deductWorker(profileId, amount, ctx)` — a transaction-guarded, clamped,
   audit-logged decrement of `worker_profiles.caBalance` — and the weekly payslip generator +
   HR profile editor call it instead of raw updates. Worker default stays **0** (manual weekly
   flow); regular-employee default changes per (6). No take-home change for workers.
6. **"This month's installment" = Σ over the employee's approved CAs of
   `min(monthlyPayment ?? balance, balance)`, oldest-first.** Legacy docs with no
   terms/monthlyPayment are single-payment advances: their installment IS the full balance —
   so old advances behave exactly as today. **THE DEFAULT CHANGES from full-balance to
   installment** for plan-bearing advances — this is precisely Neil's instruction ("if its
   registered as installment show option"); Finance can still pick Pay-in-full per run.
7. **Multi-CA order: `createdAt` ascending (oldest first), explicitly sorted** — deterministic
   and fair; the per-CA split is visible in the plan lines (no more Firestore-query-order
   roulette).
8. **`payroll_ca_overrides` is RETIRED.** The per-run choice lives on the pay-run line
   (`pay_runs.lines[i].caPlan` — WS20's frozen snapshot), edited via the Edit Payroll modal
   before Verify. Rationale: one execution record instead of two keyed collections; the
   `{uid}_{month}` key-composition class of bug disappears. The rules match stays until a
   later cleanup (WS19 notes it deprecated); existing override docs are honored by
   `planFor()` during the transition month, then ignored.
9. **Employee "Set Deduction" becomes a real request through the Approvals funnel** (it is
   silently DEAD today — rules already deny the employee's direct write). It files
   `approval_requests` type `'ca_deduct'` `{userId, month, amount, reason}`; on approval,
   `planFor()` picks it up as that month's custom amount. Matches the "every request type
   funnels through Approvals" convention.
10. **`status:'active'` is a bug** — financeDeleteCascade (departments.js:156) is corrected to
    write `'approved'`; the migration normalizes existing `'active'` docs.
11. **Authorization: one `CashAdvance.canAct()` = president ‖ manager ‖ finance-role ‖
    Finance-dept membership** (the union of today's four gates — nobody loses access). The
    secretary stays excluded (money tier). Rules-level tightening is WS19's job (recorded
    there); this workstream only unifies the client gate.

### API surface (js/config.js, after the chipTabs helpers)

```js
window.CashAdvance = {
  RATE_DEFAULT: 2,                                  // %/mo — approval-time prefill (see D3)
  canAct() { /* president|manager|finance-role|canEditDept('Finance') */ },

  async request({ amount, terms, reason, dateNeeded }) {
    // validates, writes cash_advances doc: {userId, userName, employeeId, amount, terms,
    //  interest:0, interestCharged:false, monthlyPayment:null, totalPayable:null,
    //  balance:0, status:'pending', payments:[], date:dateNeeded, reason, createdAt:serverTs}
    // (interest/monthly/total are finalized at approval); dbCacheInvalidate('ca-pending')
  },
  openRequestForm() { /* the ONE request modal (modules.js form, minus interest checkbox) */ },

  async approve(id, { interestPct = null } = {}) {
    // db.runTransaction: re-read, require status==='pending' (race-safe);
    // pct = interestPct ?? 0; total = pct>0 ? amount*Math.pow(1+pct/100, terms||1) : amount;
    // monthly = total/(terms||1);
    // t.update: {status:'approved', interest:pct, interestCharged:pct>0,
    //   totalPayable:r2(total), monthlyPayment:r2(monthly), balance:r2(total),
    //   approvedBy, approvedAt:serverTs}
    // confirm dialog shows the exact repay figure BEFORE the transaction;
    // Notifs.send to employee; logAudit; dbCacheInvalidate('ca-pending')
  },
  async reject(id, reason) { /* status:'rejected', rejectedBy/At, notify, invalidate */ },

  async recordPayment(id, { amount, date }) {
    // db.runTransaction (ALWAYS — fixes the unguarded Finance-CA path):
    // newBal = max(0, balance-amount); payments.push({amount, date, recordedBy});
    // status:'paid' + paidAt when newBal<=0; invalidate
  },

  async planFor(uid, month) {
    // → { caBalance, mode:'installment'|'full'|'custom', caPlanned,
    //     plan:[{caId, amount, installmentNo, terms, monthlyPayment}], source }
    // reads approved CAs (createdAt asc); per CA: due = min(monthlyPayment ?? balance, balance);
    // installmentNo = (caDeductions applied so far, from payments.length + prior payroll
    //   deductions counted via payments[] entries tagged source:'payroll') + 1;
    // custom sources (priority): approved approval_requests ca_deduct for month →
    //   legacy payroll_ca_overrides/{uid}_{month} (transition only) → default installment
  },

  async deduct(uid, month, plan) {
    // THE only balance mutation for payroll — called from disbursePayRun (WS20 D6), never
    // from Compute. batch: per plan line decrement balance (clamped), append
    // payments:{amount, date:today(), recordedBy, source:'payroll', month};
    // status:'paid'+paidAt at 0; writes nothing if plan empty; returns caDeductions[]
    // (same shape financeDeleteCascade reverses — cascade keeps working, but its
    //  status revert is corrected to 'approved')
  },

  async deductWorker(profileId, amount, ctx) {
    // db.runTransaction on worker_profiles/{id}: clamp to caBalance, decrement,
    // logAudit('worker-ca-deduct'); returns {before, after}
  },
};
```

### Call-site surgery (before = the verbatim blocks quoted in Current state)

| Site (file:line) | After |
|---|---|
| modules.js:1580-1657 request form | becomes `CashAdvance.openRequestForm()` body (minus interest checkbox); modal copy: "Repayment: N months · interest is set by Finance at approval" |
| app.js:4524-4548 second form | DELETED; `req-advance-btn` → `CashAdvance.openRequestForm()` |
| modules.js:1467-1503 approve (A) | `await CashAdvance.approve(id, {interestPct: <approver field>})` |
| departments.js:3506-3508 (B) | `await CashAdvance.approve(id)` — raw-amount bug gone |
| departments.js:9367-9369 (C) | `await CashAdvance.approve(id)` |
| departments.js:9989-9993 (D) | `await CashAdvance.approve(id)` — balance-never-set bug gone |
| modules.js:1516-1568 payment | `await CashAdvance.recordPayment(id, {amount, date})` |
| departments.js:3520-3539 payment | same call — gains the transaction guard |
| payroll table+modal (2429-2431, 2517-2555, 2632-2673) | line preview shows `planFor()` output; Edit-Payroll CA block becomes the 3-way chooser (below) writing `lines[i].caPlan` (or, pre-WS20, a payroll_ca_overrides doc — see sequencing) |
| Compute CA block 2715-2750 | DELETED from Compute — `deduct()` runs inside WS20's `disbursePayRun` |
| financeDeleteCascade :156 | `status:'active'` → `status:'approved'` |
| worker payslip save 4143/4196-4197 + HR profile editor 3771 | `await CashAdvance.deductWorker(...)` / editor writes routed through it |
| employee ca-deduct-req-btn app.js:4550+ | files `approval_requests` type `'ca_deduct'`; Approvals gains the chip row (approve/reject by canAct()) |

### Payroll-time UI (Edit Payroll modal CA block — replaces departments.js:2517-2533)

```
💳 Cash Advance — Outstanding: ₱65,225 · Installment 3 of 9 · ₱7,247/mo
( • ) This month's installment — ₱7,247        ← default when a plan exists
(   ) Pay off full balance — ₱65,225
(   ) Custom amount  [___________]  (max ₱65,225)
Remaining after this payroll: ₱57,978
```
Copy for legacy no-plan advances: "( • ) Full balance — ₱X (no installment plan)". The strings
"Installment N of M" come from `planFor().plan[i]` (`installmentNo`/`terms`).

### firestore.rules diff

`cash_advances` match block: UNCHANGED except documenting that `balance == 0` on self-create
is now always satisfied (single form). `payroll_ca_overrides`: unchanged, marked deprecated
(WS19 removes). `approval_requests` already has a match block (Approvals funnel) — verify its
create rule admits `type:'ca_deduct'` shape (owner-write with `hasOnly` if enumerated; if the
existing rule enumerates types, add `'ca_deduct'`).

### Migration checklist (one-time, dry-runnable, president-gated — "🔄 CA data repair")

1. Normalize `status:'active'` → `'approved'` (count reported).
2. Docs where `interestCharged==true && balance==amount && payments.length==0`
   (approved through paths B/C — interest silently dropped, untouched since):
   set `balance = totalPayable`. Docs **mid-repayment** with the same mismatch are NOT
   auto-fixed — listed in the dry-run report for Neil's per-case call (retro-charging interest
   on a partially repaid loan is a policy decision, not a data repair).
3. Legacy docs with no `terms`: set `{terms:1, monthlyPayment:balance}` (single-payment plan —
   behavior identical, now explicit).
4. Dry-run mode first: prints counts + the affected list, writes nothing (same convention as
   the WS3 June backfill).

### Sequencing with WS20
Ships in the same phase as WS20 (the deduct-at-Disburse move is WS20's D6; `planFor`/`deduct`
are its declared plug-ins). If WS22 is implemented FIRST standalone: `deduct()` is temporarily
called from the existing `!alreadyGenerated` Compute block (preserving today's timing), and the
3-way chooser writes payroll_ca_overrides `{amount}` as the custom mechanism — then WS20's
surgery relocates the call and retires the collection. Both orders are safe; do not do neither.

### What NOT to touch
Manila-time helpers (`bizDate` month keys), escHtml on userName/reason renders,
`dbCacheInvalidate('ca-pending')` on every mutator (service does it centrally), CACHE_VER
auto-bump, financeDeleteCascade's reversal-from-`salary_history.caDeductions` contract
(deduct() keeps writing that exact shape), and the two already-transactional modules.js paths'
safety level (the service is transactional everywhere — a strict upgrade).

## Risks / cross-workstream interactions

- ⚠️ CONFIRMED LIKELY-LIVE BUG: js/app.js:4535's cash_advances .add() omits `balance`, but firestore.rules:176-181 requires `request.resource.data.balance == 0` for a self-filed create; per this repo's own documented "missing-field throws" Firestore-rules gotcha, an absent field denies the rule rather than defaulting to falsy-equal. The "+ Cash Advance" button on the Personal Finance page (distinct from the Cash Advance tab's own "+ Request") is therefore plausibly broken today (create silently rejected, no try/catch around the await at app.js:4531-4548 to surface the error to the user). Verify with a live test before/while building this workstream — if confirmed dead, decide whether to fix in place or delete this second entry point in favor of modules.js's form.
- ⚠️ CONFIRMED BUG: departments.js:9958-9993 (Approvals page 'ca' subtab) approves a CA without ever setting `balance` — combined with the risk above, a request filed via app.js's broken/no-balance form and then approved via this exact tab yields an 'approved' CA with `balance: undefined`, which is silently treated as `0` (falsy) by every downstream filter (`(a.balance||0)>0`), including the payroll Compute deduction (departments.js:2409/2429) and the employee's own outstanding-balance display (app.js:4219). Net effect: an approved cash advance that both (a) never reduces the employee's take-home pay via payroll, and (b) doesn't show as outstanding anywhere — money effectively vanishes from tracking while presumably having been handed to the employee in cash.
- ⚠️ Interest under-collection: paths B (departments.js:3508) and C (departments.js:9368) both approve using the raw requested `amount`, discarding any `totalPayable`/interest computed at request time by modules.js's form. Any interest-bearing request approved through the Finance CA tab or the generic Approvals 'all' tab collects strictly less than a request of identical terms approved through the Cash Advance tab itself (path A) — a live, silent revenue/consistency gap that predates this workstream and that unifying the service must close, not just paper over in new code while old records remain inconsistent (needs a data-repair/migration pass, not just a code fix, for any already-approved docs with balance != totalPayable).
- ⚠️ Status-value drift: financeDeleteCascade (departments.js:156) writes `status:'active'` on CA-reversal (reversing a deleted payroll run's deduction) — no other code path recognizes 'active' as a valid status; every list/filter checks specifically for 'approved'. A reversed CA may become invisible to admin CA lists and Compute's `_caByUser` aggregation (which filters `.where('status','==','approved')` server-side at departments.js:2401) until someone notices and manually re-flips it. This interacts directly with workstream 1/3 (payroll compute crash + June backfill) since that's exactly the code path (delete-and-regenerate a payroll run) that would trigger this reversal.
- ⚠️ Two structurally different default behaviors for "how much to deduct if nothing is specified" exist side-by-side in the codebase for the two employee populations: regular/salaried employees default to FULL BALANCE (departments.js:2431 etc.), hourly/production workers default to ZERO (departments.js:4062, ps-ca input starts at 0). If "ONE CashAdvance service" ends up spanning both populations (see open decision), a single default policy must reconcile these without silently changing take-home pay for one population or the other on rollout.
- ⚠️ financeDeleteCascade's CA-reversal increments balance via `FieldValue.increment(cd.amount)` reading from a frozen `salary_history.caDeductions` array — if the new service changes how/where per-run CA deductions are recorded (e.g. moves this off salary_history onto a new subcollection), the payroll-record-delete reversal path (workstream interacts with workstream 20 "One payroll engine" and workstream 3 "ledger backfill") must be updated in lockstep or deleting a pay run will stop restoring CA balances correctly, silently double-charging the employee on the next real Compute.
- ⚠️ The payslip PDF (app.js:4666 printPayslip / window._payslipData built at app.js:4257-4265) shows only a live-computed 'CA Outstanding Balance' snapshot pulled fresh from cash_advances at render time — it does NOT read the frozen `salary_history.caDeducted` value for the period being printed, so a payslip printed later for a past month will show today's balance, not what was actually deducted that month. This conflicts with workstream 20's stated goal ("Compute freezes per-employee snapshot lines... past months reprint exactly") and with workstream 24 ("the payslip... monthly print buttons fixed") — flag the overlap so whichever workstream lands first doesn't get silently undone by the other.
- ⚠️ No transaction guard on 2 of 4 approval paths (departments.js:3506-3508, departments.js:9367-9369) and on 1 of 2 payment-record paths (departments.js:3520-3539) means a double-click or two concurrent admins can currently double-approve or double-record a payment against the same CA (the only paths that guard against this are modules.js:1479-1493 and modules.js:1538-1551, both using db.runTransaction with a fresh re-read + status check). Any consolidation must not regress the two paths that already got this right.
- ⚠️ Multi-department/multi-role authorization disagreement across the 4 approval surfaces (role-based vs Finance-dept-membership vs capability-map) means a 'finance' role user who is NOT a member of the Finance department can approve/reject via the Cash Advance tab (modules.js gate: role in {president,manager,finance}) but is silently blocked from the two Approvals-page surfaces (APPROVAL_CAPS.ca = {president,manager} only, no 'finance'). This is confusing UX today (same person, different capability depending on which of 4 screens they use) independent of any security concern.
- ⚠️ This workstream's payroll_ca_overrides collection and the pay_runs Compute/Verify/Disburse state machine (workstream 20) are tightly coupled: Compute currently reads overrides fresh every run and is explicitly gated `!alreadyGenerated` for the actual balance-decrement (departments.js:2715). If workstream 20 changes what "Compute" freezes or how re-computation is detected, the CA-deduction idempotency guard riding on `alreadyGenerated` (derived from a salary_history query, not the pay_runs state doc) must be re-validated — they are currently two independent idempotency mechanisms for what is conceptually one operation.
- ⚠️ Migrating/backfilling existing cash_advances docs (to fix the balance/interest inconsistency, or to add an installment/terms shape to legacy app.js-created docs that never had terms/monthlyPayment) is itself a live-money data-migration operation on documents that may currently be mid-repayment for real employees — needs the same care as the June payroll-ledger backfill (workstream 3) already done this cycle: idempotent, dry-runnable, and reversible.

## Files likely touched

`js/modules.js (renderCashAdvancePage, renderCashAdvanceEmployee, renderCashAdvanceAdmin, renderCAList, renderCAEmployeeCards, openCashAdvanceModal, openPresidentCashAdvanceModal — lines ~1244-1745)`, `js/departments.js (renderFinanceCA ~3445-3569; the Approvals-page CA handling in both the 'all' aggregated tab ~9261-9376 and the dedicated 'ca' subtab ~9958-10006; the payroll _caByUser/_caOverrideByUser/loadPayrollTable/edit-emp-pay-btn/Compute block ~2393-2769; financeDeleteCascade's cash_advances branch ~149-160; possibly the worker_profiles/payslips CA fields ~3736,3771,4060-4143,4196-4231 IF the unification open-decision is resolved to include workers)`, `js/app.js (renderPersonalFinance's req-advance-btn request form and ca-deduct-req-btn override request, ~4524-4600+; the pending-CA badge dbCachedGet call sites ~2246,2461,2572,2683; printPayslip/_payslipData CA display ~4203-4219,4666-4685; openEmpStandingsModal's CA summary ~4699-4715)`, `firestore.rules (cash_advances match ~169-192; payroll_ca_overrides match ~303-309; possibly a new collection if the service introduces one, e.g. a normalized installment/ledger subcollection)`, `js/config.js (candidate home for a new shared window.CashAdvance service object, given script load order — modules.js loads after app.js, so a service usable by both must load earlier)`, `sw.js (CACHE_VER bump — auto-handled by pre-commit hook per repo convention, but any new file added must also be added to PRECACHE list per CLAUDE.md)`, `V12-PLAN.md (mark workstream 22 status/build-log entry on completion, per the file's own stated role as the resumption document)`

## Expected deliverable format

> Fable's output for this workstream should be structured so Sonnet can implement it mechanically with zero further judgment calls:
> 
> 1. RESOLVED-DECISIONS SECTION FIRST — explicit answers to every item in openDecisions above (balance formula, default policy, worker_profiles in/out of scope, override-collection design, employee-request-vs-finance-write for overrides, authorization model, multi-CA ordering, 'active' status fix), each stated as a one-line ruling plus a one-line rationale — not left implicit in the code samples that follow.
> 
> 2. EXACT API SURFACE for the shared service (e.g. `window.CashAdvance.request(...)`, `.approve(id, {approvedBy, balanceOverride?})`, `.reject(id, {reason?})`, `.recordPayment(id, {amount, date, recordedBy})`, `.deductForPayroll(userId, month, {mode: 'full'|'installment'|'custom', customAmount?})`, `.getInstallmentInfo(caDoc) -> {installmentNumber, totalInstallments, thisMonthDue}`) — full function signatures, parameter types, return shapes, and which Firestore ops each performs (transaction vs plain write, exact fields touched) — as literal code, not prose description.
> 
> 3. BEFORE/AFTER CODE BLOCKS for every one of the ~9 call sites enumerated in filesTouched, keyed by exact file:line-range from currentState above, showing the current code verbatim (already provided in this brief) immediately followed by the replacement code that calls the new shared service. No call site should be left for Sonnet to "figure out how to adapt."
> 
> 4. EXACT firestore.rules DIFF — full before/after text for the cash_advances and payroll_ca_overrides match blocks (and any new collection), not a description of what should change.
> 
> 5. NUMBERED MIGRATION/BACKFILL CHECKLIST for existing live cash_advances docs — what a one-time script must do (e.g. recompute balance from totalPayable where interest was charged but balance still equals raw amount; normalize any status:'active' to 'approved'; backfill terms/monthlyPayment onto legacy app.js-shaped docs or explicitly flag them as legacy/no-installment-plan) — written so it's a checklist Sonnet can turn into a script and run once, idempotently, with a dry-run mode per this repo's established backfill-script convention (see workstream 3's precedent).
> 
> 6. UI SPEC for the three payroll-time choices ("this month's installment" / "pay in full" / "custom") as exact markup/copy (mirroring the existing "Leave blank = deduct full ₱X" placeholder style already in the codebase) plus the exact per-employee display fields required (balance, this-month default amount, "installment N of M" string, and how it's computed from `payments.length`+`terms` or from a payroll-run counter — state which).
> 
> 7. A short "what NOT to touch" list confirming which existing behaviors (Manila-time helpers, escHtml calls, CACHE_VER bump automation, dbCacheInvalidate('ca-pending') calls, the idempotency guard on Compute) must be preserved verbatim by any refactor, referencing the constraints section above by name so Sonnet doesn't need to re-derive them from first principles.
