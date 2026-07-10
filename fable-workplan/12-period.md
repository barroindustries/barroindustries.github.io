# Workstream 12 — Period Engine + Period Close (v12 Barro Ops System)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

PLAN CONTEXT: V12-PLAN.md line 61-63 defines workstream 12 as: ONE shared period filter (kills the 3 divergent YTD implementations); picker for any month/quarter/year; close-period lock; fix orderBy(date) dropping date-less rows (records-forever guarantee). Line 42-44 (Phase 1, already done) says Finance Dashboard/Analytics/Reports already got a Last Month tab via the shared finPeriodMatch helper, and explicitly defers the full any-month/quarter/year picker to workstream 12. Line 65 (workstream 13, chart of accounts) and line 89 (workstream 20, kill the second payroll-compute path) both touch code this workstream also touches -- see risks.

IMPLEMENTATION 1 -- the shared helper (already shared by 2 consumers, pre-dates v12): app.js lines 2645-2666 define window.FIN_PERIOD_TABS = [[month,This Month],[prev,Last Month],[ytd,Since Jan 1],[all,All Time]]; window.prevBizMonth(); window.finPeriodMatch(dateStr, period) which does: all -> true; ytd -> dateStr.slice(0,4) equals String(bizYear()); prev -> dateStr.slice(0,7) equals prevBizMonth(); default month -> dateStr.slice(0,7) equals bizDate().slice(0,7). Also window.finPeriodLabel(period) and window.finPeriodBar(active, onclickJs) which renders a .subtab-bar of buttons (the onclickJs string has the literal token %P% replaced per tab). Git blame (commit 9281be1, Phase 1) confirms FIN_PERIOD_TABS/finPeriodMatch/finPeriodLabel already existed BEFORE v12 with only month/ytd/all -- Phase 1 only added the prev key plus prevBizMonth(). Two consumers today: renderFinanceDashboard (app.js:2670), which reads window._FIN_DASH_PERIOD (app.js:2677), filters ledger at app.js:2694 via ledger.filter(e => finPeriodMatch(e.date, period)), and renders its picker via finPeriodBar(period, ...) at app.js:2733; and renderOverview, the overview sub-tab of renderAnalytics (outer fn renderAnalytics at app.js:6087, renderOverview at app.js:6173), which reads window._AN_PERIOD (app.js:6174) and filters at app.js:6182-6184. Both consumers use identical keys: month / prev / ytd / all.

IMPLEMENTATION 2 -- renderFinancialReports own separate logic: departments.js lines 2881-2969, function signature window.renderFinancialReports(container, currentUser, currentRole, range='month'). It does NOT call finPeriodMatch at all -- it re-implements filtering inline: if range==='month', filter rows whose date.slice(0,7) equals todayStr.slice(0,7); if range==='prev', slice(0,7) equals prevBizMonth(); if range==='year', date.slice(0,4) equals String(bizYear()); else (range==='all') no filter. Key-name divergence: this uses the key 'year' where the shared helper uses 'ytd' for the IDENTICAL concept (both = since Jan 1 of bizYear()) -- functionally the same math, different spelling, duplicated code. The picker markup is also separate: a bespoke rangeBtn() closure at departments.js:2924 building its own .subtab-bar, not finPeriodBar(). Two callers: departments.js:1950 (case 'Reports' in the Finance tab switch, defaults range='month'), and departments.js:1583 inside window.runLedgerBackfill, which forces range='all' after a sync so newly-posted rows are visible regardless of period. This function also reads TWO collections (ledger AND general_journal, merged into one array) unlike the shared-helper consumers which read only ledger -- the period filter here applies uniformly across both merged row shapes, so any migration must preserve that.

THE THIRD PLACE -- reported honestly as ambiguous rather than invented: I grepped exhaustively for range===, period===, bizYear(), slice(0,4)=== (year-equality/YTD style), and the literal tab-label strings (This Month / Last Month / Since Jan 1 / Year to Date / All Time / Quarter) across app.js, departments.js and modules.js. Only the two implementations above have a user-facing period PICKER (tabs the user can click). There is no third tab-based picker anywhere in the codebase. However there is a third CATEGORY of divergence that the plan's "3 divergent" phrasing may be referring to: several finance-adjacent widgets hardcode this-month-only with their own from-scratch month-slice logic and NO picker at all, so the user can never see last month or YTD there: (a) renderFinanceAnalytics, the finance sub-tab of renderAnalytics, app.js:6349-6394, uses its own inMonth()/thisMonth closures defined once at the top of renderAnalytics (app.js:6131-6136) instead of finPeriodMatch, e.g. disbursedThisMonth = ledger.filter(l => isPayroll(l) && inMonth(l))...; (b) renderProgressReports, app.js:5007-5044, computes its own monthStr = bizDate().slice(0,7) and filters tasks into monthTasks, no other period offered; (c) the Purchasing spend KPI inside renderPurchaseRequests, departments.js:12338-12360, computes ym = bizDate().slice(0,7) and a fixed monthSpend; (d) renderFinanceHRProfiles, departments.js:3577-3596, computes monthStr = bizDate().slice(0,7) to filter payslips "This Month", no other period. Separately (NOT a report-period filter, a different concept): the Payroll tab's pr-month-sel dropdown (departments.js:2157-2164) and the Record Monthly Payroll modal's pr-month input (app.js:4107) pick which month's PAYROLL RUN to compute/edit -- a write-scope selector, not a read-side reporting period. Fable should not conflate the two but should be aware both exist so the new component's naming/API does not collide. Given this, I recommend Fable treat the identity of the "3rd divergent implementation" as an open question (see openDecisions) rather than assume a specific one -- the two clean tab implementations are certain; how many of the hardcoded-month widgets to fold into the shared component is a real design call.

LEDGER-WRITING FUNCTIONS (for the period-close-lock guard) -- grepped db.collection(ledger).add( across app.js/departments.js/modules.js -- 14 write sites total (all in app.js/departments.js; modules.js has none): (1) postExpenseToLedger(expId, e), departments.js:1414-1431, idempotent ref EXP-{expId}, date: e.date || today() where e.date comes from the approved expense doc (can be backdated) -- BACKDATABLE. (2) postCRJToLedger(crjId, e), departments.js:1436-1453, ref CRJ-{crjId}, date: e.date || today() from the cash-receipt-journal row -- BACKDATABLE. (3) postCDJToLedger(cdjId, e), departments.js:1458-1480, ref CDJ-{cdjId}, date: e.date || today() from the cash-disbursement-journal row -- BACKDATABLE. (4) window.backfillPayrollLedger(), departments.js:1547-1573, ref PAY-{month}-{uid}, date: month + '-01', a one-time recovery tool that reconstructs a past month's missing rows from salary_history -- BACKDATABLE BY DESIGN (its whole purpose is posting into a past month); a naive period-close guard would break this tool for exactly the months it exists to fix. (5) Payroll-history edit resync, departments.js:2255-2293 (inside the "Edit history record" modal handler), writes PAY-{rec.month}-{rec.userId} at date: rec.month + '-01' when editing an existing salary_history row that has no matching ledger row yet -- BACKDATABLE (editing an arbitrarily old month's payroll record is the whole feature). (6) Monthly Compute Payroll (department Payroll tab), departments.js:2701, inside the loop over employees for the selected month (from pr-month-sel, departments.js:2157-2164, defaults to current month but lists all history months too), ref PAY-{month}-{u.id}, date: month + '-01' -- BACKDATABLE, finance can select and re-compute any past month from the dropdown. (7) Manual "New Ledger Entry" modal (Ledger tab), departments.js:3037-3079 (write at 3064), date comes straight from a raw date input the user can set to ANY date past or future, and there is NO idempotent ref at all (free-form) -- HIGHEST-RISK backdating vector: no ref-based de-dupe, arbitrary date, arbitrary category/type. (8) Worker Payslip "Submit" posting, departments.js:3839-3873 (write at 3867), ref WPAY-{ps.id}, date: ps.payDate || ps.payPeriodEnd || today(), payPeriodEnd can be a past pay period -- BACKDATABLE. (9) Design-project payment recording, departments.js:6151-6192 (write at 6183), ref DPROJ-{p.id}-{index}, date comes from a free date input on the payment form (defaults to today but editable) -- BACKDATABLE; this write is wrapped in try/catch because a non-Finance Design-dept member may lack ledger write rights under firestore.rules (the code comment at departments.js:6174-6176 confirms this best-effort behavior is intentional). (10) Department budget expense entry (generic dept-budgets screen), departments.js:10678-10705 (write at 10690), date comes from a free date input, dept-tagged category, no idempotent ref (an optional user-typed reference number, not a deterministic one) -- BACKDATABLE, no idempotency. (11) Sales-order revenue posting, departments.js:8631, ref is a deterministic ledgerRef built earlier in that flow (an SO- style ref per CLAUDE.md conventions), date: today() -- always today, not backdatable from this call site itself. (12) Project-milestone/contract revenue posting, departments.js:11338, ref projLedgerRef (also SO- style), date: today() -- always today. (13) Production-materials-consumption COS posting, consumeProductionMaterials(order), departments.js:11610-11652 (write at 11641), ref POCOS-{order.id}, date: today() -- always today; this is also the ONE non-Finance-role write path firestore.rules explicitly carves out (a Production-dept user can create this specific shape of ledger row directly, see dataModel). (14) Second, duplicate payroll-compute path, app.js lines 4149-4172 (write at 4170), inside window.renderPersonalFinance's President/Manager "Team" KPI view (app.js:3952), triggered by the "Record Payroll" button (app.js:4033) opening the "Record Monthly Payroll" modal (app.js:4092-4107) whose month value comes from a free pr-month input (app.js:4107), NOT constrained to the current month, ref PAY-{month}-{doc.id}, date: month + '-01' -- BACKDATABLE. This is the exact "second compute path" that V12-PLAN.md workstream 20 ("kill the second compute path") targets for removal -- see risks. Summary: of the 14 write sites, 10 accept a backdated/arbitrary date (1,2,3,5,6,7,8,9,10,14), 1 is a deliberate recovery tool that MUST remain able to write into closed periods (4), and 3 always post at today() so a closed-period check there is lower priority (11,12,13) -- though Fable should still check whether the underlying order/project transaction date (not the ledger post date) can itself be backdated before assuming these three are safe.

## Data model

ledger/{docId} (Firestore collection, canonical single source of truth per CLAUDE.md) -- fields observed across all 14 write sites: date (string YYYY-MM-DD, Manila via bizDate()/today(), but sometimes YYYY-MM-01 for month-level payroll rows -- NOT always a full calendar date, which matters for any period-close date-range comparison), type ('credit'|'debit'; there is no 'payslip' type despite an old comment implying one -- confirmed by the code comment "Payroll is posted as type:'debit' category:'Payroll Expense' (no type:'payslip' exists)"), amount (number), category (free string, e.g. Sales Revenue, Payroll Expense, COS - Direct Material, or "<Dept> Income/Expense"), description, refNumber (deterministic idempotent string for automated posts: EXP-/CRJ-/CDJ-/PAY-/WPAY-/DPROJ-/POCOS-/SO- or project-specific -- but free/optional for the manual Ledger-tab entry, site 7 above), source (e.g. Finance, Expense, Cash Receipt, Cash Disbursement, Production, Design, or a department name), addedBy/addedByName, createdAt (serverTimestamp), and optionally dept, budgetLineId/budgetLineName, projectId, vatAmount/inputVat/net (for VAT-aware rows), fileUrl. There is NO existing field marking a row as belonging to a closed period, and NO existing finance_periods (or similarly named) collection anywhere in the repo -- grepped for period-close/isClosed/periodLock/closePeriod, zero hits. The lock is a greenfield addition.

general_journal/{docId} -- a separate collection merged into the working array inside renderFinancialReports and renderLedgerTab at read time (departments.js:2883-2891 and 2973-2991); each row has debit/credit fields (not a single amount+type like ledger), plus date, accountTitle, reference -- each doc can expand into up to 2 synthetic ledger-shaped rows (one debit row, one credit row) client-side before filtering.

cash_receipt_journal/{docId} and cash_disbursement_journal/{docId} -- read via orderBy(date desc).limit(100) (departments.js:3116 and 3225) with NO period filter at all today, just the latest 100 rows; their approved rows get mirrored into ledger via postCRJToLedger/postCDJToLedger.

salary_history/{uid_month} -- fields: month (YYYY-MM), userId, userName, salary, allowance, deductions, netPay, finalPay, kpiScore, attScore, recordedBy/recordedAt. Read and written by both payroll-compute paths (departments.js:2677-2703 and app.js:4139-4147) and the history-edit modal (departments.js:2262-2267).

payslips/{docId} (worker/weekly payslips, distinct from salary_history which is monthly office payroll) -- fields: payPeriodMonth, payPeriodStart/End, payDate, netPay, grossPay, status ('verified'|'filed'|'submitted'), workerName. Posting to ledger happens only on the "submitted" transition (departments.js:3851-3869).

pay_runs/{month} -- referenced in firestore.rules (line 321) and the "Payroll pay-run workflow" memory note (Compute to Verify to Disburse); not directly read/written by the 14 ledger-write sites above, but likely a more natural home for a per-period "locked" concept once workstream 20 unifies payroll compute -- Fable should check whether pay_runs/{month} is a better fit for a period-close flag than inventing a new collection, since it is already keyed by month.

projects / job_projects -- payments array (each entry: amount, date, method, note, byName, by) is the source for the Design-payment ledger post (departments.js:6154-6189); also arBalance, stage.

firestore.rules coverage for the money collections (lines 582-637): ledger -- read: canFinance() only (no other role, including Production or Design, can even READ the ledger collection; writes attempted from those depts rely on try/catch-swallowed permission errors as noted above); create: canFinance() OR (canProduction() AND a tightly fenced shape requiring category==='COS – Direct Material', source==='Production', type==='debit', amount is a positive number, and refNumber matching POCOS-.*); update: canFinance(); delete: isPresident() only (matches the "Finance delete approval" memory pattern). general_journal, cash_receipt_journal, cash_disbursement_journal, finance_records, tax_records, purchase_orders all follow the identical canFinance()-gated create/update, president-only-delete shape (lines 601-637). salary_history (line 285) and pay_runs (line 321) have their own rules not read in this pass -- Fable should re-open firestore.rules around lines 280-340 before finalizing a closed-period rule, since any enforcement done inside rules would need a get() against wherever the closed flag lives, and per the "Firestore rules missing-field throws" and "collection coverage" memory notes, a missing field or a missing collection match will silently DENY rather than fail open -- a real hazard for a security-relevant feature like this one.

## Constraints — must respect

- Manila-time discipline: all date computation in this workstream must go through window.bizDate()/bizYear() (config.js lines 18-37, backed by Intl.DateTimeFormat pinned to Asia/Manila) -- never raw new Date().toISOString(). Every existing period implementation already follows this; the shared component must too.
- escHtml() before any interpolation into innerHTML (CLAUDE.md convention used throughout departments.js/app.js) -- any new period-picker markup (month names, labels) must escape any string that could ever be user-influenced, even though today's period labels are all code-generated.
- Deterministic idempotent refNumber pattern for automated ledger posts (CLAUDE.md: ledger is finance's single source of truth with deterministic idempotent refs SO-/EXP-/CRJ-/CDJ-/POCOS-/PAY-) -- every existing automated write site checks a where(refNumber==ref).limit(1).get() before posting (e.g. departments.js:1416-1417, 1438-1439, 1460-1461, 1556-1557, 2270, 11639). A period-close guard must not add a second read that breaks or duplicates this existing idempotency check.
- Firestore composite-index / rules-coverage requirement: if this workstream adds a new collection (e.g. finance_periods) or a new query shape (e.g. a ledger date-range query), firestore.rules AND firestore.indexes.json must both be updated and deployed via firebase deploy --only firestore -- git push alone does not deploy rules (memory: firebase-deploy-rules).
- Missing-field-in-rules pitfall: if a closed-period check reads a field or a get() on a periods doc inside firestore.rules, any doc missing that field/doc must use .get(field, default) -- a bare field read on an absent field denies the whole rule silently; this previously broke presence/active status the same way (memory: firestore-rules-missing-field-throws).
- Script load order: index.html loads scripts with defer in the fixed order firebase-config.js, config.js, drive.js, notifications.js, departments.js, app.js, modules.js, all communicating only via window.* globals (no ES modules). window.FIN_PERIOD_TABS/finPeriodMatch/finPeriodLabel/finPeriodBar currently live in app.js (lines 2645-2666), which loads AFTER departments.js, yet departments.js already calls window.prevBizMonth() successfully (departments.js:2897) -- this only works today because the call happens at click-time (well after all scripts have executed), not at module-load time. Any refactor that relocates the shared helper (e.g. into config.js, which loads earlier) should preserve this window-global, call-only-after-load pattern.
- CACHE_VER bump requirement: any edit to app.js/departments.js/config.js/css requires bumping CACHE_VER in sw.js -- now auto-handled by the pre-commit hook per the sw_cache_bump_required memory note, but confirm it still fires for this change set.
- dbCachedGet/dbCacheInvalidate caching layer (config.js lines 212-239): ledger, expenses, ca-pending etc. are cached client-side with 30-45s TTLs via window.dbCachedGet(key, fetcher, ttlMs). Every ledger write site above calls dbCacheInvalidate('ledger') after a successful post. Critically, today's period-tab switch is a pure client-side re-filter of an already-fetched in-memory array (ledger.filter(...)), NOT a new Firestore read -- any redesign that instead issues a fresh server-side date-range query per period switch (relevant if workstream 16's performance work lands first) needs its own cache-key strategy, not a drop-in replacement of the existing pattern.
- orderBy(date) silently drops rows with no date field -- 4 confirmed sites: departments.js:2884 and 2974 (ledger), departments.js:2885 and 2975 (general_journal), plus departments.js:3116 (cash_receipt_journal) and departments.js:3225 (cash_disbursement_journal). V12-PLAN.md explicitly folds this fix into workstream 12 itself, not a separate workstream -- Fable must decide the fix (e.g. always set date at write time with a today() fallback, a query fallback that also fetches date-less docs, or a one-time backfill) as part of this brief.
- Existing UI-component convention for shared render helpers: window.chipTabs(items, activeKey, opts) returns an HTML string, paired with window.bindChipTabs(scope, onSelect) to wire clicks after re-render (config.js lines 293-335) -- this is the established reusable-declutter pattern in this codebase (memory: ui-chip-tabs-and-sop-helpers), distinct from the older .subtab-bar/.subtab-btn markup that finPeriodBar and renderFinancialReports' rangeBtn both currently use. A new shared period-picker should follow one of these two existing patterns rather than invent a third.
- Ledger read is finance-only at the rules layer (firestore.rules line 583: allow read if isAuth() and canFinance()) -- no other role can query the ledger collection at all. Any shared period-picker embedded in a non-Finance screen (Design, Production) that needs ledger-derived numbers already relies on try/catch-swallowed permission errors (departments.js lines 6174-6192 confirm this is accepted, intentional behavior) -- the shared component's API must not assume ledger reads always succeed.

## DECIDED — architecture spec (Fable, 2026-07-09)

### Decisions

**D1 — Period = compact canonical string, parsed to bounds.** A period is a string key:
`'month:2026-07'` · `'quarter:2026-Q3'` · `'year:2026'` · `'all'`, plus resolving aliases
`'month'` (current), `'prev'`, `'ytd'`, and `'year'` (legacy Reports spelling → same as ytd).
One parser produces inclusive date bounds — which also future-proofs WS16's server-side
`where('date','>=',…)` range queries with zero API change. `finPeriodMatch` survives as a thin
alias, so every existing call site keeps working unmodified until migrated.

**D2 — Canonical key is `'ytd'`; `'year'` becomes an accepted parse alias.** No persisted user
preference exists (`_FIN_DASH_PERIOD`/`_AN_PERIOD` are in-memory) → no migration risk. WS10's
URL params must use these canonical keys (recorded for WS10). **Live-number callout: none** —
Reports keeps merging general_journal exactly as today; the engine only replaces the filter
math, which is provably identical (`slice(0,7)`/`slice(0,4)` semantics preserved).

**D3 — Scope of picker adoption:** Finance Dashboard, Analytics Overview, Financial Reports,
**plus** renderFinanceAnalytics (app.js:6349 — it lives inside Analytics one tab from the
picker; leaving it hardcoded would show contradicting numbers on the same screen). **NOT
migrated** (fixed status KPIs, never pickers): renderProgressReports (app.js:5007), Purchasing
spend KPI (departments.js:12348), renderFinanceHRProfiles this-month payslips
(departments.js:3577). Listed so nobody assumes they were forgotten.

**D4 — Closed flag lives in a new `finance_periods/{YYYY-MM}` collection**:
`{closed:true, closedBy:uid, closedByName, closedAt:serverTimestamp, note?:string}`.
NOT pay_runs (books-close ≠ payroll workflow; WS20 is about to restructure pay_runs — coupling
them guarantees a conflict). Quarters/years derive from constituent months. Per-month
granularity, reopenable, add to monthly-backup EXPORTS (WS15 discipline).

**D5 — Enforcement: both layers (defense in depth), consistent with the POCOS precedent.**
- *Client:* `window.assertPeriodOpen(dateStr)` — throws with the user-facing message
  `"That month's books are closed. Ask the President to reopen ${month} first."` Fires BEFORE
  the write → distinguishable from permission-denied.
- *Rules:* the ledger `create` clause gains a period gate using rules string `split()` (rules
  strings support split/list indexing): month key = `date.split('-')[0]+'-'+date.split('-')[1]`,
  then `!exists(finance_periods/$month) || get(…).data.get('closed',false)==false`. Missing doc
  = open (fail-open on absence — the safe default per the missing-field-denies memory).
  President bypasses (`isPresident()`).
- **No hidden code exemptions.** Recovery tools (backfillPayrollLedger, history-edit resync) do
  NOT bypass the lock — the governance model is: President **reopens the month → fix runs →
  re-close**, every step audit-logged. One mental model, no secret side doors. The Sync-to-ledger
  backfill additionally client-skips closed months and reports "N rows skipped (closed months)".
- Only PAST months are closable (UI blocks closing the current Manila month) — which is why the
  three `today()`-dated write sites need no client guard.

**D6 — Date integrity (the orderBy date-less fix), three parts:** (i) rules now REQUIRE
`date` matching `^\d{4}-\d{2}(-\d{2})?$` on ledger create (every one of the 14 sites already
sends it — verified in this brief — so no legacy-client breakage); (ii) one-time maintenance
action **"🩹 Fix undated rows"** (president, Reports tab): full-collection read (no orderBy),
docs missing/malformed `date` get `date := createdAt`'s Manila date, else `today()`; logAudit +
count toast; re-runnable; (iii) after that backfill, the existing `orderBy('date')` reads no
longer drop rows. Same treatment (client always sends date) noted for general_journal, whose
rows Reports merges.

**D7 — No frozen snapshots.** Reports stay live-computed; the ledger remains the single source
of truth. A closed month can only change via deliberate, logged President action
(reopen→edit→re-close). The BIR filing workstream (WS39) will capture printed/PDF exports as
the filed artifact of record.

**D8 — WS20 sequencing:** guard BOTH payroll-compute paths now (2 lines each; the legacy
app.js path is live until WS20 deletes it — a wasted 2-line guard is cheaper than an open
hole). **WS13 coordination:** renderFinancialReports and the ledger `create` rule are touched by
both 12 and 13 — Sonnet must implement 12+13 as ONE combined diff; the merged rules block below
already composes both.

**D9 — UI: chipTabs pattern + inline custom row (no pop-ups).** Quick chips
`This Month · Last Month · YTD · All · 📅 Custom`; tapping Custom expands an inline row (not a
modal): `<input type="month">` + quarter `<select>` + year `<select>` + Apply. Shared helpers in
config.js beside chipTabs. Reports' bespoke rangeBtn and app.js's finPeriodBar are both replaced.
When the viewed period is a closed month, the picker shows a `🔒 Closed` badge; Reports (only)
adds the President's `🔒 Close <month>` / `Reopen` button.

---

### Spec 1 — `window.Period` module (js/config.js, replaces the app.js helper block)

```js
// ── Period engine (v12 WS12) — ONE period filter for all money screens ──
window.Period = (() => {
  const ym = () => bizDate().slice(0, 7);
  const bounds = {
    parse(key) {                     // → {type,key,start,end,label} (end inclusive, null=∞)
      key = String(key || 'month');
      if (key === 'month') key = 'month:' + ym();
      if (key === 'prev')  key = 'month:' + prevBizMonth();
      if (key === 'ytd' || key === 'year') key = 'year:' + bizYear();
      if (key === 'all') return { type:'all', key:'all', start:null, end:null, label:'All Time' };
      let m;
      if ((m = key.match(/^month:(\d{4})-(\d{2})$/))) {
        const s = `${m[1]}-${m[2]}`;
        return { type:'month', key, start:`${s}-01`, end:`${s}-31`, label: new Date(`${s}-01T12:00:00`).toLocaleString('en-PH',{month:'long',year:'numeric'}) };
      }
      if ((m = key.match(/^quarter:(\d{4})-Q([1-4])$/))) {
        const q = +m[2], sm = String((q-1)*3+1).padStart(2,'0'), em = String(q*3).padStart(2,'0');
        return { type:'quarter', key, start:`${m[1]}-${sm}-01`, end:`${m[1]}-${em}-31`, label:`Q${q} ${m[1]}` };
      }
      if ((m = key.match(/^year:(\d{4})$/)))
        return { type:'year', key, start:`${m[1]}-01-01`, end:`${m[1]}-12-31`, label:`Year ${m[1]}` };
      return bounds.parse('month');                       // unknown → safe default
    },
    match(dateStr, key) {
      const ss = String(dateStr || ''); if (!ss) return false;
      const p = typeof key === 'object' ? key : bounds.parse(key);
      if (p.type === 'all') return true;
      const d = ss.length === 7 ? ss + '-15' : ss;        // month-level rows (YYYY-MM) match inside
      return d >= p.start && d <= p.end;
    },
    monthKeyOf(dateStr) { return String(dateStr||'').slice(0, 7); },
  };
  return bounds;
})();
// Back-compat aliases — existing call sites keep working untouched:
window.finPeriodMatch = (dateStr, period) => Period.match(dateStr, period);
window.finPeriodLabel = (period) => Period.parse(period).label
  .replace(/^Year \d{4}$/, m => (period==='ytd'||period==='year') ? 'YTD ' + bizYear() : m);
```
`FIN_PERIOD_TABS`/`finPeriodBar`/`prevBizMonth`: `prevBizMonth` MOVES to config.js verbatim;
the old app.js block (2645-2666) is deleted; `FIN_PERIOD_TABS` is superseded by the picker below.

### Spec 2 — Shared picker (config.js, beside chipTabs)

```js
window.periodPicker = function(activeKey, opts = {}) { /* returns HTML string */ }
window.bindPeriodPicker = function(scope, onSelect) { /* wires chips + custom row; calls onSelect(newKey) */ }
```
Chips: `[['month','This Month'],['prev','Last Month'],['ytd','YTD'],['all','All Time'],['custom','📅 Custom']]`
rendered via the existing `chipTabs` markup classes. `custom` toggles an inline
`<div class="period-custom-row">` (flex, `display:none` until toggled) containing
`<input type="month" max="<current>">`, quarter/year selects (years: 2024→current), and Apply →
`onSelect('month:YYYY-MM' | 'quarter:YYYY-Qn' | 'year:YYYY')`. When `Period.parse(activeKey)`
is a specific month/quarter/year, the custom chip shows that label + active state. If
`opts.closedBadge` and the resolved period is a closed month (read-through
`dbCachedGet('finance_periods', …, 60000)`), append `<span class="badge badge-gray">🔒 Closed</span>`.
Consumers + their migration: renderFinanceDashboard (app.js:2733 finPeriodBar→periodPicker;
filter at 2694 unchanged — alias handles it), Analytics Overview (app.js:6203 same),
renderFinanceAnalytics (app.js:6349-6394: replace the `inMonth()` closure with
`Period.match(l.date, window._AN_PERIOD||'month')` so it follows the Analytics picker),
renderFinancialReports (departments.js:2924 rangeBtn block → periodPicker; its inline
month/prev/year/all filter at 2896-2899 → `all = all.filter(e => Period.match(e.date, range))`;
`range` values become canonical keys; runLedgerBackfill's forced `'all'` still works).

### Spec 3 — Close/guard machinery

```js
// config.js
window.isPeriodClosed = async function(dateStr) {         // read-through cached
  const mk = Period.monthKeyOf(dateStr); if (!mk) return false;
  const snap = await dbCachedGet('finperiod-' + mk,
    () => db.collection('finance_periods').doc(mk).get(), 60000).catch(() => null);
  return !!(snap && snap.exists && snap.data().closed);
};
window.assertPeriodOpen = async function(dateStr) {
  if (await isPeriodClosed(dateStr)) {
    const mk = Period.monthKeyOf(dateStr);
    Notifs.showToast(`That month's books are closed. Ask the President to reopen ${mk} first.`, 'error');
    throw new Error('period-closed:' + mk);
  }
};
```
Close/Reopen (Reports tab, president-only, shown when viewing a specific past month):
`🔒 Close <label>` → `finance_periods/{mk}.set({closed:true, closedBy, closedByName, closedAt})`
+ `logAudit('close-period', 'finance_periods', mk)` + `dbCacheInvalidate('finperiod-'+mk)`;
`Reopen` sets `closed:false` (doc kept — history) + logAudit. UI must refuse to close the
current Manila month.

**Write-site checklist** (site numbers from Current state; guard = `await assertPeriodOpen(<date>)`
immediately before the write, inside the existing try/catch where present):
| # | Site | Verdict |
|---|---|---|
| 1-3 | post{Expense,CRJ,CDJ}ToLedger 1414-1480 | GUARDED (one line at top of each; covers all mirror re-syncs) |
| 4 | backfillPayrollLedger 1547 | GUARDED-SOFT: `if (await isPeriodClosed(month+'-01')) { skipped++; continue; }` + report count |
| 5 | history-edit resync 2255-2293 | GUARDED |
| 6 | Compute Payroll 2701 (month from pr-month-sel) | GUARDED (check once, before the employee loop) |
| 7 | Manual New Ledger Entry 3064 | GUARDED (highest priority — free date, no ref) |
| 8 | Worker payslip submit 3867 | GUARDED (on ps.payDate ‖ payPeriodEnd) |
| 9 | Design payment 6183 | GUARDED (before its try/catch so the period error isn't swallowed as permission-denied) |
| 10 | Dept budget expense 10690 | GUARDED |
| 11-13 | SO 8631 / PROJ 11338 / POCOS 11641 (always today()) | EXEMPT — current month is never closable; rules backstop still applies |
| 14 | Legacy Record Payroll app.js:4170 | GUARDED (2 lines; WS20 deletes the whole path later) |

### Spec 4 — firestore.rules (composed WITH WS13 — this is the final merged text)

New collection block:
```
match /finance_periods/{month} {
  allow read: if canFinance();
  allow create, update: if isPresident();
  allow delete: if false;
}
```
Helper + the ledger block's final `create` clause (COMPOSES WS13 Spec 4 — implement once):
```
function ledgerDateOk() {
  return request.resource.data.get('date','').matches('^\\d{4}-\\d{2}(-\\d{2})?$');
}
function periodOpen() {
  return isPresident() ||
    !exists(/databases/$(database)/documents/finance_periods/$(
      request.resource.data.get('date','').split('-')[0] + '-' +
      request.resource.data.get('date','').split('-')[1])) ||
    get(/databases/$(database)/documents/finance_periods/$(
      request.resource.data.get('date','').split('-')[0] + '-' +
      request.resource.data.get('date','').split('-')[1])).data.get('closed', false) == false;
}

// ledger create — WS12 gate wrapped around WS13's account-aware clause:
allow create: if ledgerDateOk() && periodOpen() && (
  canFinance() ||
  ( canProduction() && <WS13 Spec 4's Production two-leg predicate verbatim> )
);
```
Cost: +1 rules read per ledger create (the exists/get — served from the same get). Update/delete
stay president-only (already stricter than the gate). Deploy with the usual re-diff-first
discipline; add `finance_periods` to scripts/monthly-backup.js EXPORTS in the same commit.

### Spec 5 — "🩹 Fix undated rows" (Reports tab, president-only, idempotent)

Full ledger + general_journal read WITHOUT orderBy; for each doc where
`!/^\d{4}-\d{2}(-\d{2})?$/.test(doc.date||'')`: set `date` = Manila date of `createdAt`
(`createdAt.toDate()` through the Intl Asia/Manila formatter) else `today()`; batched 400/write;
logAudit('fix-undated', …, {count}); toast the count. Re-runnable (matches nothing once clean).

### Spec 6 — Migration checklist

1. One combined implementation pass with WS13 (same functions, same rules block — see D8).
2. Rules deploy first (Spec 4 merged text; old clients unaffected — they always send date, and
   no month is closed yet so periodOpen() passes everywhere).
3. App code: config.js Period/picker/guards; delete app.js:2645-2666 helper block; migrate the
   four consumers; insert the 11 GUARDED call-site lines; add Close/Reopen + Fix-undated buttons.
   `node --check` ×4 + preview boot (zero console errors) before commit.
4. Live: president runs **🩹 Fix undated rows**; verify Reports row counts vs the Ledger tab.
5. Close the oldest complete month as the first real close; verify a backdated manual entry
   into it is blocked with the period-closed toast (and via devtools, denied by rules).

### What did NOT change
Progress Reports / Purchasing spend KPI / HR payslips-this-month stay fixed current-month
cards. general_journal merge behavior in Reports unchanged. No report totals change from this
workstream (D2 callout); the only user-visible number changes come from WS13's restatement,
announced separately.

## Risks / cross-workstream interactions

- ⚠️ Workstream 20 (kill the second compute path, V12-PLAN.md line 89) directly targets one of the same two payroll-compute functions this workstream would need to guard (departments.js:2701 vs app.js:4170, both writing PAY-{month}-{uid} ledger rows). Sequencing risk: if workstream 12 adds a period-close check to both paths and workstream 20 later deletes one, that is wasted or conflicting work; if workstream 20 runs first, workstream 12 only needs to guard the surviving path. Read workstream 20's own grounding brief (if produced) before finalizing which call sites get touched.
- ⚠️ Workstream 13 (chart of accounts, V12-PLAN.md line 64-66) adds an account-type field to ledger rows and explicitly fixes 'double material expensing' -- this touches the SAME ledger-write functions (especially the Production COS post at departments.js:11641 and the expense/CDJ posts at 1418/1469) that this workstream's closed-period guard would also wrap. If both workstreams touch these function bodies in the same rebuild pass, coordinate diff order to avoid a merge conflict over the same short functions.
- ⚠️ Workstream 16 (performance/unbounded reads, line 75-76) explicitly calls out 'limits/date filters on the unbounded reads' including ledger -- renderFinancialReports currently pulls limit(3000) of both ledger and general_journal client-side, then filters by period in JS (departments.js:2884-2898). A genuinely 'any month/quarter/year' picker over years of history could make this fetch-everything-then-filter pattern increasingly slow, pushing toward a server-side date-range query, which is workstream 16's territory. Decide whether workstream 12 should design the API to support Firestore where(date>=...)/where(date<=...) range queries from day one, even before workstream 16 lands, to avoid a second migration later.
- ⚠️ The manual 'New Ledger Entry' modal (departments.js:3037-3079) has NO idempotent ref and a fully free date input -- it is the single easiest place for a user to accidentally or deliberately post into a period that should be closed, and the ONE write site with zero existing safety rail (no ref-based de-dupe, no fixed category). If period-close only guards the automated/idempotent posting functions and misses this manual modal, the whole feature is trivially bypassable -- this is the highest-priority site for the guard.
- ⚠️ The Design-project-payment (departments.js:6151-6192) and generic dept-budget-expense (departments.js:10678-10705) ledger posts are both reachable by non-Finance department members whose writes may already silently fail under firestore.rules' canFinance()-only create gate -- current code treats that as an accepted best-effort failure via try/catch. Layering a period-close rules check on top of the existing role check compounds an already-silent failure mode; ensure the two checks produce distinguishable user-facing errors (permission-denied vs period-closed) rather than collapsing into the same generic catch handler.
- ⚠️ backfillPayrollLedger() (departments.js:1547-1573) and the June-recovery flow are the reason Phase 1 shipped at all (V12-PLAN.md workstreams 1 and 3) -- this function's entire purpose is writing PAY- rows into a month that, under any naive 'most-months-are-closed' policy, would already be closed. If period-close ships without an explicit carve-out for this backfill tool, it will silently break the exact recovery mechanism Phase 1 just fixed, for the exact incident (June) that motivated it.
- ⚠️ renderFinancialReports' 'year' key and the shared helper's 'ytd' key currently compute the same thing but are spelled differently -- a refactor that naively aliases one to the other without checking that both bizYear()-based branches are truly equivalent (they are today, modulo renderFinancialReports also including general_journal rows the shared helper never reads) could silently change reported YTD totals in one screen but not another -- a live-number change that needs explicit call-out in the migration checklist, not a silent key rename.

## Files likely touched

`js/app.js (FIN_PERIOD_TABS/finPeriodMatch/finPeriodLabel/finPeriodBar/prevBizMonth block around lines 2642-2666; renderFinanceDashboard around lines 2670-2813; renderAnalytics/renderOverview around lines 6087-6251; possibly renderFinanceAnalytics around 6349-6394 and renderProgressReports around 5007-5044 if folded into the shared component; second payroll-compute path around lines 4092-4172 if guarded)`, `js/departments.js (renderFinancialReports around lines 2881-2969; renderLedgerTab around 2972-3113; manual ledger-entry modal around 3020-3079; renderCashReceiptJournal around 3115-3225 and the disbursement-journal renderer; postExpenseToLedger/postCRJToLedger/postCDJToLedger around lines 1412-1480; backfillPayrollLedger around 1547-1573; runLedgerBackfill around 1575-1585; salary_history edit-resync around 2255-2293; Compute Payroll loop around 2670-2711; worker-payslip submit around 3839-3873; Design-payment post around 6151-6192; generic dept-budget-expense post around 10660-10705; production COS post (consumeProductionMaterials) around 11610-11652; Purchasing spend KPI around 12338-12360 if folded in)`, `js/config.js (candidate new home for the shared period helper if Fable decides to relocate it earlier in load order; dbCachedGet/dbCacheInvalidate if the caching strategy changes; possibly a new finance_periods read-through cache entry)`, `firestore.rules (new match block for a periods/finance_periods collection if that is the chosen data-model answer; possibly an added get()-based closed-period condition on the existing ledger/general_journal/cash_receipt_journal/cash_disbursement_journal create/update rules around lines 582-620)`, `firestore.indexes.json (only if a server-side date-range query is introduced)`, `css/styles.css (only if the picker UI moves off .subtab-bar/.subtab-btn onto .chip-tabs/.chip-tab, or needs new classes for a month/quarter/year selector control)`, `sw.js (CACHE_VER bump -- auto-handled by the pre-commit hook per memory, but confirm it fires)`

## Expected deliverable format

> Fable's output for this workstream should be structured so Sonnet can implement it mechanically with no further judgment calls: (1) A single resolved decisions section at the top that answers every item in openDecisions explicitly, not deferred -- including the exact chosen key/parameter shape for the period value, the exact collection and field name/shape for the closed-period flag, and which of the 14 ledger-write call sites get the guard, expressed as a literal checklist against the file:line list in currentState with each site marked GUARDED or EXEMPT-plus-why. (2) Exact new/changed function signatures with full before/after code blocks for the replacement shared period helper (must be either a drop-in or a clearly-migrated replacement for window.finPeriodMatch/finPeriodLabel/FIN_PERIOD_TABS/finPeriodBar/prevBizMonth) and for renderFinancialReports' range parameter (either removed in favor of the shared helper, or explicitly kept and reconciled with the ytd/year key mismatch). (3) A numbered migration checklist, one item per call site touched, using the exact file:line citations already given in this brief, each with the literal diff (or close-enough pseudo-diff) so Sonnet does not need to re-derive it -- including explicit handling of the general_journal-merge subtlety in renderFinancialReports so the YTD-vs-year reconciliation risk is not silently mishandled. (4) The exact firestore.rules diff as full replacement text for every touched match block, not just prose description, given how strict this codebase's every-collection-needs-explicit-coverage / missing-field-denies discipline is. (5) An explicit closed-period exemption list mirroring the risks/openDecisions sections: which functions (backfillPayrollLedger, the salary_history edit-resync, any others Fable decides) are allowed to bypass the lock, and exactly how that bypass is expressed in code (role check, explicit flag parameter, or a separate function entirely). (6) A short "what did NOT change" note listing the hardcoded this-month-only widgets Fable decides to leave alone, so a later reviewer does not assume they were forgotten. (7) One paragraph explicitly calling out any live number the user will observe changing post-migration (e.g. if Financial Reports' Year to Date total changes because it now, or no longer, includes general_journal rows), since this app's owner has been burned by live-money regressions this same week per V12-PLAN.md's Phase 1 framing, and needs to know before deploy.
