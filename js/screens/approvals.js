/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Approvals screen (owner/oversight approval queue)
   js/screens/approvals.js

   Wave 7 Pass 8 — split out of js/departments.js verbatim, 2026-08-03,
   following the Wave 2 (design.js) / Wave 7 Pass 1-7 extraction
   protocol. Still plain `window.*`-attached globals, no ESM, no
   bundler — this file is a physical split only, not a module.

   Extraction history: Pass 1 (tasks.js) and Pass 2 (sales.js) both
   evaluated renderApprovals and deferred it to Pass 8 ("too entangled
   with services; extract only if clean"). Re-checked here: the
   deferral predates (or predates being acted on) the v13 Phase 35
   Approvals service refactor (js/svc-approvals.js), which already
   pulled every approval type's WRITE logic (signup/leave/finance-req/
   finance-del/etc.) out from under renderApprovals into
   Approvals.dispatch(type, action, id, ctx) — one write path per type,
   called here as `Approvals.dispatch(...)`, a bare global exactly like
   every other cross-file service call this wave documents. What's
   left in renderApprovals itself is pure UI: pending-count queries,
   tab/list rendering, and thin click handlers that call
   Approvals.dispatch / window.CashAdvance / window.RaiseFlow /
   window.approvePurchaseOrder / window.rejectPurchaseOrder / the
   quote-approval helpers below. Grepped the full ~1180-line range for
   direct money-service calls (window.Ledger., financeExecuteDelete,
   financeDeleteCascade, postExpenseToLedger/postCRJToLedger/
   postCDJToLedger, resyncLedgerForSource, assertPeriodOpen,
   computePayRun/disbursePayRun/reopenPayRun) — zero hits. The
   extraction is clean; this was a single CONTIGUOUS cut (departments.js
   lines 4660-5841, comment header through the end of
   openQuoteApprovalReview), not a stitched-together set of excerpts.

   Contents:
   - window.renderApprovals — the approval-authority model (President/
     Manager can act; Corporate Secretary is view-only/escalate-only on
     MAJOR items per the two-tier oversight map APPROVAL_CAPS), the
     13-collection pending-count fetch (+ grading-queue count for
     President/Manager), the chip-tab nav (All Requests/Grading/Tasks
     for Review/Sign-ups/Attendance/Cash Advances/Raises/Quote
     Approvals/PO Approvals/Finance Requests/Deletions/Leave — via
     window.chipTabs/bindChipTabs, already clean, no hand-rolled
     `.subtab-bar` found), and loadApprovalsSub (the per-tab list
     renderer + action-button wiring, reusing the cached 'all'-tab
     snapshot for its own list where possible).
   - approveQuoteApproval / returnQuoteToPartner / openQuoteApprovalReview
     — the partner quote-approval helpers, used exclusively by this
     screen's Quote Approvals tab (and by svc-approvals.js's
     'quote-approval' registry entry, which calls them as bare globals
     — same runtime-only resolution pattern).

   8-point treatment: verified intact post-move, no stragglers found.
   1. chipTabs — window.chipTabs/bindChipTabs already used throughout;
      no hand-rolled `.subtab-bar`.
   2. Surfaces — openPage/openModal only (the quote-review flow is a
      real openPage panel); no raw #page-content swaps.
   3. Loading/empty/error — the pending-count Promise.all already
      `.catch()`s every query into a safe empty shape with a logged
      console.error; each tab's list shows a "All clear!" empty state
      via renderEmptyState-shaped markup on zero results.
   4. Tables — this screen is card-based (approval-card divs), no
      `<table>` markup, so no `.table-cards` gap applies.
   5. Icons — every icon-only-looking action button here carries a
      visible text label (Approve/Reject/Deny/View Task/etc.) alongside
      the Lucide icon, so no bare icon-only button needed an
      aria-label; grepped clean.
   6. Headers — one `.page-header` (Approvals + pending-count badge).
   7. Styling — unchanged; no forced token sweep.
   8. sopPanel — Approvals is a single unified queue, not a department
      screen with its own SOP; no gap (matches the known-gap list,
      which doesn't include Approvals).

   Money-math boundary: renderApprovals/approveQuoteApproval/
   returnQuoteToPartner/openQuoteApprovalReview call Approvals.dispatch,
   window.CashAdvance.openApproveModal/reject, window.RaiseFlow.approve/
   reject, window.approvePurchaseOrder/rejectPurchaseOrder, and plain
   db.collection(...).update() calls scoped to quote/approval_requests
   docs (not ledger writes) — no money-posting logic is defined in this
   file.
*/


// ══════════════════════════════════════════════════
//  OWNER — APPROVAL REQUESTS
// ══════════════════════════════════════════════════
window.renderApprovals = async function(currentUser) {
  const c = deptContainer();
  // ── Approval authority (oversight model) ──────────────────────────────
  // President + Manager can act on routine requests; the Corporate Secretary is
  // VIEW-ONLY (oversight). Approving a DELETE of a key record is President-only —
  // the same boundary firestore.rules enforces (delete → president). canAct hides
  // routine action buttons for the secretary; canDelete hides delete-approval
  // buttons for everyone but the President.
  const _role     = window.currentRole || '';
  // ── Per-approval-type capability map (two-tier oversight) ───────────────
  // The Corporate Secretary may act on MINOR, non-money items (sign-ups,
  // attendance, work submissions, review-tasks, leave). MAJOR / money-moving
  // items (cash advances, quote approvals, payroll & finance deletes, quote /
  // client deletions) stay President-only (manager keeps the routine set).
  // For major items the secretary sees a "Request President approval" action
  // instead of approve/deny. Mirrors firestore.rules (delete → president).
  const APPROVAL_CAPS = {
    'signup':         ['president','manager','secretary'],
    'attendance':     ['president','manager','secretary'],
    'submission':     ['president','manager','secretary'],
    'review-task':    ['president','manager','secretary'],
    'leave':          ['president','manager','secretary'],
    'ca':             ['president','manager'],
    'ca_deduct':      ['president','manager'], // v12 WS22 — employee's CA-deduction-for-this-run request
    'raise':          ['president'], // v12 WS23 — only the President approves/rejects a raise request
    'quote-approval': ['president','manager'],
    'po-approval':    ['president','manager'], // v12 WS30 — PO gate; money-moving → secretary escalates
    'finance-req':    ['president'],
    'finance-del':    ['president'],
    'delete-quote':   ['president'],
    'delete-client':  ['president'],
  };
  const canActOn   = (type) => (APPROVAL_CAPS[type] || ['president','manager']).includes(_role);
  const canEscalate = (type) => _role === 'secretary' && !canActOn(type);
  const canAct     = _role === 'president' || _role === 'manager';
  const canDelete  = (typeof isRealPresident === 'function') ? isRealPresident() : (_role === 'president');
  const _showGrading = (_role === 'president' || _role === 'manager');
  // Secretary escalation: ping the President to review a major item.
  const requestPresidentApproval = async (label) => {
    try {
      await Notifs.sendToOwner({
        title: '🙋 Approval Requested',
        body: `${(window.userProfile && window.userProfile.displayName) || 'The Corporate Secretary'} asks you to review: ${label}.`,
        icon: '🙋', type: 'approval_result'
      });
      Notifs.success('Sent to the President for approval.');
    } catch (e) { Notifs.showToast('Could not send request', 'error'); }
  };
  // Check pending counts for badges.
  // v13 Phase 35 — this is the SAME 13-collection fetch loadApprovalsSub('all')
  // needs for its own list, so the result is cached in _cachedAllSnaps and
  // reused there instead of being fetched twice on every page load. The cache
  // is single-use: it's consumed (and cleared) the first time loadApprovalsSub('all')
  // runs, which happens immediately below; any later re-visit to the 'all' tab
  // refetches fresh data the normal way.
  // ⚠ 2026-08-09 — THE QUEUE USED TO LIE WHEN DENIED.
  // Every one of these 14 queries ended in `.catch(() => ({size:0, docs:[]}))`,
  // so a query the RULES refused rendered as "0 pending" — indistinguishable
  // from "nothing needs attention" on the one screen whose entire job is to tell
  // you something needs attention. A reviewer sees a clean queue and moves on.
  // _apq() keeps the same fail-soft shape (a denial must never blank the page)
  // but STAMPS the failure, so the categories below can be LABELLED as
  // unavailable instead of silently reported as empty. Role-independent by
  // construction: it reacts to what the boundary actually did, not to a guess
  // about who is signed in, so it keeps working for any future role scoping.
  const _deniedQueues = [];
  const _apq = (label, chip, q) => q.get().catch(e => {
    console.error('approval count query failed', label, e);
    const denied = !!e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''));
    _deniedQueues.push({ label, chip, denied });
    return { size: 0, docs: [], failed: true, denied };
  });
  const [sgSnap, atSnap, caSnap2, subSnap2, reviewTasksSnap, finReqSnap2, finDelSnap2, qApprSnap2, delQSnap2, delBKQSnap2, delCSnap2, leaveSnap2, poSnap2, raiseSnap2] = await Promise.all([
    _apq('Sign-ups', 'signups',                 db.collection('signup_requests').where('status','==','pending')),
    _apq('Attendance', 'attendance',            db.collection('attendance_extensions').where('status','==','pending')),
    _apq('Cash Advances', 'ca',                 db.collection('cash_advances').where('status','==','pending')),
    _apq('Work submissions', 'all',             db.collection('submissions').where('status','==','pending')),
    _apq('Tasks for Review', 'review-tasks',    db.collection('tasks').where('status','==','review')),
    _apq('Payroll delete requests', 'finance-requests', db.collection('payroll_delete_requests').where('status','==','pending')),
    _apq('Finance delete requests', 'finance-requests', db.collection('finance_delete_requests').where('status','==','pending')),
    _apq('Quote / ROA', 'roa',                  db.collection('approval_requests').where('status','==','pending')),
    _apq('BS quote deletions', 'all',           db.collection('bs_quotes').where('deleteRequested','==',true)),
    _apq('BK quote deletions', 'all',           db.collection('bk_quotes').where('deleteRequested','==',true)),
    _apq('Client deletions', 'all',             db.collection('clients').where('deleteRequested','==',true)),
    _apq('Leave', 'leave',                      db.collection('leave_requests').where('status','==','pending')),
    _apq('Purchase approvals', 'all',           db.collection('purchase_requisitions').where('approvalStatus','==','pending')),
    _apq('Raises', 'all',                       db.collection('pending_raises').where('status','==','pending_approval'))
  ]);
  // Chips whose count is now known to be incomplete, and the human labels behind
  // them. 'All Requests' sums every queue, so ANY failure makes it incomplete.
  const _incompleteChips = new Set(_deniedQueues.map(d => d.chip));
  if (_deniedQueues.length) _incompleteChips.add('all');
  const _deniedLabels    = _deniedQueues.map(d => d.label);
  // A count is trustworthy only if nothing feeding it failed. The rule that
  // matters is the one the silent-zero bug broke: NEVER render a bare 0 for a
  // category we did not actually get to check.
  //   • nothing failed              -> the real number
  //   • something failed, n  > 0    -> the real number. Some chips are fed by
  //                                    TWO collections (Finance Requests =
  //                                    payroll deletes + finance deletes), and
  //                                    the Corporate Secretary is MEANT to see
  //                                    the payroll-delete half (owner ruling 1).
  //                                    Blanking it to '—' would hide items they
  //                                    is supposed to act on; the 🔒 on the label
  //                                    and the banner carry the "incomplete".
  //   • something failed, n == 0    -> '—', never 0. Number('—') is NaN, so the
  //                                    "has items" pill stays off too.
  const _cnt = (chip, n) => (_incompleteChips.has(chip) && !n) ? '—' : n;
  // Persistent marker on any chip whose count cannot be complete, independent of
  // what the number happens to be this render.
  const _lbl = (chip, label) => _incompleteChips.has(chip) ? (label + ' 🔒') : label;
  let _cachedAllSnaps = { sgSnap, atSnap, caSnap2, subSnap2, reviewTasksSnap, finReqSnap2, finDelSnap2, qApprSnap2, delQSnap2, delBKQSnap2, delCSnap2, leaveSnap2, raiseSnap2, poSnap2 };
  const pendingSignups = sgSnap.size || 0;
  const pendingExt     = atSnap.size || 0;
  const pendingCA      = caSnap2.size || 0;
  const pendingSubs    = subSnap2.size || 0;
  const pendingReview  = reviewTasksSnap.size || 0;
  const pendingFinReqs = (finReqSnap2.size || 0) + (finDelSnap2.size || 0);
  const pendingQApprovals = qApprSnap2.size || 0;
  const pendingDeletes    = (delQSnap2.size || 0) + (delBKQSnap2.size || 0) + (delCSnap2.size || 0);
  const pendingLeave      = leaveSnap2.size || 0;
  const pendingPO         = poSnap2.size || 0;
  const pendingRaises     = raiseSnap2.size || 0;
  const totalPending   = pendingSignups + pendingExt + pendingCA + pendingSubs + pendingReview + pendingFinReqs + pendingQApprovals + pendingDeletes + pendingLeave + pendingPO + pendingRaises;

  // ── Grading queue count (President's grading subtab) ──────────────────
  // Completed/approved tasks awaiting a presidentScore + employees whose
  // monthly self-assessment awaits a president grade. Only fetched for the
  // roles that can see the Grading chip, to keep the page load lean.
  let pendingGrading = 0;
  if (_showGrading) {
    try {
      const [gtSnap, geSnap] = await Promise.all([
        db.collection('tasks').where('status','in',['approved','completed','done']).get().catch(()=>({docs:[]})),
        db.collection('kpi_evals').get().catch(()=>({docs:[]}))
      ]);
      const ungradedTasks = gtSnap.docs.filter(d=>typeof d.data().presidentScore !== 'number').length;
      const ungradedKpi   = geSnap.docs.filter(d=>{const x=d.data();return x.selfGrade!=null && x.presidentGrade==null;}).length;
      pendingGrading = ungradedTasks + ungradedKpi;
    } catch(_){}
  }

  const approvalChips = [
    { key:'all',              label:_lbl('all','All Requests'), icon:emojiIcon('📋',14), count: _cnt('all', totalPending) },
    _showGrading ? { key:'grading', label:'Grading',    icon:emojiIcon('⭐',14), count: pendingGrading } : null,
    { key:'review-tasks',     label:_lbl('review-tasks','Tasks for Review'), count: _cnt('review-tasks', pendingReview) },
    { key:'signups',          label:_lbl('signups','Sign-ups'),              count: _cnt('signups', pendingSignups) },
    { key:'attendance',       label:_lbl('attendance','Attendance'),         count: _cnt('attendance', pendingExt) },
    { key:'leave',            label:_lbl('leave','Leave'),          icon:emojiIcon('🌴',14), count: _cnt('leave', pendingLeave) },
    { key:'ca',               label:_lbl('ca','Cash Advances'),              count: _cnt('ca', pendingCA) },
    { key:'roa',              label:_lbl('roa','Quote / ROA'),               count: _cnt('roa', pendingQApprovals) },
    { key:'quote-files',      label:'Quote Files',      icon:emojiIcon('📁',14) },
    { key:'finance-requests', label:_lbl('finance-requests','Finance Requests'), icon:emojiIcon('💼',14), count: _cnt('finance-requests', pendingFinReqs) },
    { key:'history',          label:'History',          icon:emojiIcon('🗄️',14) },
  ].filter(Boolean);

  // Explicit, non-alarming statement of what could NOT be loaded. Shown to
  // whoever hit the denial, with the category NAMED — the whole point is that
  // "we didn't check this" must never look like "we checked, nothing there".
  const _deniedBanner = _deniedQueues.length ? `
    <div class="alert-banner" style="cursor:default;margin-bottom:10px">
      <span>${emojiIcon('🔒',16)} <strong>Not shown to you:</strong> ${escHtml(_deniedLabels.join(', '))}.
      ${_deniedQueues.every(d => d.denied)
        ? 'These queues are outside your access, so their counts read “—” rather than 0. The President and Finance still see them.'
        : 'These queues could not be loaded just now, so their counts read “—” rather than 0. Try refreshing.'}</span>
    </div>` : '';

  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('✅',20)} Approvals</h2>${totalPending>0?`<span class="badge badge-red" style="font-size:13px">${totalPending}${_deniedQueues.length?'+':''} pending</span>`:''}</div>
    ${window.sopPanel('How approvals work', [
      'Every request (sign-ups, cash advances, leave, deletes, quotes, etc.) lands here as one unified queue — default view is All Requests, pending only.',
      'Use the chips to filter by type; each chip shows a live pending count.',
      _showGrading ? 'President/Manager: the Grading chip queues completed tasks and self-assessments waiting for a score — separate from routine approvals.' : 'Money-moving and deletion requests are President-only; the Secretary can act on everyday items and escalate the rest.',
      'Already-decided items don\'t clutter the queue — find them under the History chip (last 30 days, read-only).'
    ])}
    ${_deniedBanner}
    ${_role==='secretary'?`<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${emojiIcon('👁',16)} <strong>Secretary oversight.</strong> You can approve everyday items (sign-ups, attendance, leave, submissions, task reviews). Cash advances, raises and payroll deletions stay visible here so you can flag them — approving them is the President's.</span></div>`
      :!canAct?`<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${emojiIcon('👁',16)} <strong>Oversight view.</strong> You can review every request here, but only the President approves.</span></div>`
      :!canDelete?`<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${emojiIcon('ℹ️',16)} Deletion of key records requires <strong>President</strong> approval.</span></div>`:''}
    ${window.chipTabs(approvalChips, 'all')}
    <div id="approvals-content">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });

  // Which sub-tab the DOM currently inside #approvals-content belongs to. Seeded
  // to 'all' because the container is rendered above ALREADY holding the 'all'
  // skeleton, and 'all' is also what loadApprovalsSub is first called with at the
  // bottom of this function — so the very first load correctly skips re-painting
  // a skeleton over the byte-identical skeleton that is already on screen.
  let _paneSub = 'all';

  // Visible acknowledgement for a re-tap of the ALREADY-ACTIVE chip (see the
  // fromChip note below). Inline styles rather than a new CSS class, and it is
  // injected INSIDE #approvals-content so every branch's `wrap.innerHTML = …`
  // fill disposes of it for free. The .spinner class supplies the spin
  // animation; its stock border colours are white-on-dark button colours, so
  // both are re-pointed at theme tokens to stay visible on a page background.
  const REFRESHING_BAR = `<div id="approvals-refreshing" style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);padding:2px 2px 10px"><span class="spinner" style="width:12px;height:12px;border-color:var(--border);border-top-color:var(--text-muted)"></span>Refreshing…</div>`;

  // Owns the pane's LOADING lifecycle — skeleton-vs-retain, the refresh
  // affordance, and the disable/re-enable pair — around renderApprovalsPane
  // below, which owns what is actually drawn. Split in two purely so the
  // re-enable can live in a `finally`: the pane renderer is ~1000 lines of
  // per-chip branches, several of which return early, and one of them throwing
  // must not be able to strand the rows in a disabled state.
  // opts.fromChip: this call came from a chip tap rather than from a
  // post-action refresh (see the same-sub case below).
  const loadApprovalsSub = async (sub, opts) => {
    const wrap = document.getElementById('approvals-content');
    if (!wrap) return;
    // Acting here mutates signup_requests / attendance_extensions / cash_advances /
    // approval_requests. Invalidate the dashboard's cached pending counts so badges
    // and lists don't keep showing already-actioned items for up to the 30s TTL.
    if (typeof dbCacheInvalidate === 'function')
      ['signups-pending','att-ext-pending','ca-pending','approvals-pending'].forEach(k => dbCacheInvalidate(k));
    // ── Skeleton on a real tab CHANGE only — never on a post-action refresh ──
    // Every approve/reject/deny handler in this function ends by calling
    // loadApprovalsSub(<the tab it is already on>) to pick the write up. This
    // line used to blank the entire list to a 4-row skeleton on that refresh
    // too: the President taps Approve on the 30th row, the whole page collapses
    // to four grey bars — which is far SHORTER than the list was, so the browser
    // clamps the scroll offset toward the top — and then re-grows with the new
    // list, leaving him at the top of a list he was reading the bottom of. The
    // refetch returns the same data minus one row, so the list already on screen
    // is a perfectly good thing to keep looking at while it runs, and the action
    // has already acknowledged itself with a toast.
    //
    // A tab SWITCH still gets the skeleton, and must: 'history' fires ten
    // parallel queries and 'all' fourteen, and leaving the previous tab's rows
    // up with no loading signal for that long reads as "the chip did nothing".
    // Tracking which sub currently OWNS the pane is what separates the two cases
    // — same sub = refresh (keep), different sub = switch (skeleton). The
    // firstElementChild test is the genuine-empty-pane fallback.
    //
    // Retained rows get their buttons disabled for the duration of the refetch.
    // Blanking the pane used to make a second click on an already-actioned row
    // physically impossible the instant the write resolved; keeping the rows up
    // hands that possibility back, and nothing else prevents it — onClickSafe
    // (js/departments.js) wraps handlers in try/catch but disables nothing, and
    // most handlers here call loadApprovalsSub WITHOUT awaiting it, so the
    // handler (and any guard tied to it) is finished while the refetch is still
    // in flight. A double Approve on a leave request would dispatch the balance
    // debit twice. Only buttons that were live get collected, so restoring them
    // can't wrongly enable one that shipped `disabled` in its own markup, and
    // the `finally` at the bottom — not the fill — is what guarantees the
    // disabled state never outlives the load, on every path including a throw.
    //
    // The same-sub case covers TWO different events, and only one of them has
    // already acknowledged itself: a post-action refresh (toast already shown,
    // stay quiet) and a re-tap of the chip that is already active. The re-tap is
    // a deliberate "give me fresh data" request and must answer immediately —
    // disabled buttons alone are not an answer, because three of these panes can
    // contain no buttons at all (the 'all' empty state, the read-only History
    // list, Grading's not-permitted notice), which left the tap looking dead for
    // the entire length of a 14-collection refetch.
    let toRestore = [];
    if (_paneSub !== sub || !wrap.firstElementChild) {
      wrap.innerHTML = window.skeletonHtml('rows');
    } else {
      toRestore = Array.from(wrap.querySelectorAll('button:not([disabled])'));
      toRestore.forEach(b => { b.disabled = true; });
      if (opts && opts.fromChip) wrap.insertAdjacentHTML('afterbegin', REFRESHING_BAR);
    }
    _paneSub = sub;

    try {
      await renderApprovalsPane(sub, wrap);
    } finally {
      // Unconditional: an early return or a throw inside any branch must never
      // leave the rows unclickable with no way back. Buttons the fill already
      // replaced are detached, so isConnected skips them.
      const bar = wrap.querySelector('#approvals-refreshing');
      if (bar) bar.remove();
      toRestore.forEach(b => { if (b.isConnected) b.disabled = false; });
    }
  };

  // Draws one chip's pane into `wrap`. Called ONLY via loadApprovalsSub above,
  // which has already put the pane into its loading state and will restore it.
  const renderApprovalsPane = async (sub, wrap) => {
    if (sub === 'all') {
      // ── All Pending Requests aggregated view ──
      // No .orderBy() here — combining it with .where() requires a Firestore composite
      // index per-collection. If that index isn't provisioned, the query is rejected and
      // silently swallowed by .catch(), making items vanish from "All Requests". We sort
      // client-side instead so a missing index can never hide pending items.
      // v13 Phase 35 — reuse the count fetch above on the very first load instead
      // of re-querying all 13 collections a second time. Only a later re-visit
      // to this tab (cache already consumed) hits Firestore again here.
      let sgSnap, atSnap, caSnap2, subSnap2, reviewTasksSnap, finReqSnap2, finDelSnap2, qApprSnap2, delQSnap2, delBKQSnap2, delCSnap2, leaveSnap2, raiseSnap2, poSnap2;
      if (_cachedAllSnaps) {
        ({ sgSnap, atSnap, caSnap2, subSnap2, reviewTasksSnap, finReqSnap2, finDelSnap2, qApprSnap2, delQSnap2, delBKQSnap2, delCSnap2, leaveSnap2, raiseSnap2, poSnap2 } = _cachedAllSnaps);
        _cachedAllSnaps = null;
      } else {
        ([sgSnap, atSnap, caSnap2, subSnap2, reviewTasksSnap, finReqSnap2, finDelSnap2, qApprSnap2, delQSnap2, delBKQSnap2, delCSnap2, leaveSnap2, raiseSnap2, poSnap2] = await Promise.all([
          db.collection('signup_requests').where('status','==','pending').get().catch(e=>{console.error('signup_requests query failed',e);return {docs:[]};}),
          db.collection('attendance_extensions').where('status','==','pending').get().catch(e=>{console.error('attendance_extensions query failed',e);return {docs:[]};}),
          db.collection('cash_advances').where('status','==','pending').get().catch(e=>{console.error('cash_advances query failed',e);return {docs:[]};}),
          db.collection('submissions').where('status','==','pending').get().catch(e=>{console.error('submissions query failed',e);return {docs:[]};}),
          db.collection('tasks').where('status','==','review').get().catch(e=>{console.error('tasks query failed',e);return {docs:[]};}),
          db.collection('payroll_delete_requests').where('status','==','pending').get().catch(e=>{console.error('payroll_delete_requests query failed',e);return {docs:[]};}),
          db.collection('finance_delete_requests').where('status','==','pending').get().catch(e=>{console.error('finance_delete_requests query failed',e);return {docs:[]};}),
          db.collection('approval_requests').where('status','==','pending').get().catch(e=>{console.error('approval_requests query failed',e);return {docs:[]};}),
          db.collection('bs_quotes').where('deleteRequested','==',true).get().catch(e=>{console.error('bs_quotes delete query failed',e);return {docs:[]};}),
          db.collection('bk_quotes').where('deleteRequested','==',true).get().catch(e=>{console.error('bk_quotes delete query failed',e);return {docs:[]};}),
          db.collection('clients').where('deleteRequested','==',true).get().catch(e=>{console.error('clients delete query failed',e);return {docs:[]};}),
          db.collection('leave_requests').where('status','==','pending').get().catch(e=>{console.error('leave_requests query failed',e);return {docs:[]};}),
          db.collection('pending_raises').where('status','==','pending_approval').get().catch(e=>{console.error('pending_raises query failed',e);return {docs:[]};}),
          db.collection('purchase_requisitions').where('approvalStatus','==','pending').get().catch(e=>{console.error('purchase_requisitions query failed',e);return {docs:[]};})
        ]));
      }

      const allPending = [
        ...sgSnap.docs.map(d=>({id:d.id,...d.data(),type:'signup',icon:'👤',label:'Sign-up Request',name:d.data().fullName||d.data().email||'Unknown',detail:d.data().email||'',ts:d.data().createdAt})),
        ...atSnap.docs.map(d=>({id:d.id,...d.data(),type:'attendance',icon:'⏰',label:'Attendance Extension',name:d.data().userName||'Unknown',detail:d.data().date||'',ts:d.data().requestedAt})),
        ...caSnap2.docs.map(d=>({id:d.id,...d.data(),type:'ca',icon:'💸',label:'Cash Advance',name:d.data().userName||'Unknown',detail:`₱${fmt(d.data().amount||0)}`,ts:d.data().createdAt})),
        ...subSnap2.docs.map(d=>({id:d.id,...d.data(),type:'submission',icon:'📤',label:'Work Submission',name:d.data().submittedByName||d.data().userName||d.data().authorName||'Unknown',detail:d.data().title||'',ts:d.data().createdAt})),
        ...reviewTasksSnap.docs.map(d=>({id:d.id,...d.data(),type:'review-task',icon:'📋',label:'Task for Review',name:d.data().title||'Untitled Task',detail:(()=>{const uids=Array.isArray(d.data().assignedTo)?d.data().assignedTo:[d.data().assignedTo].filter(Boolean);const nm=(d.data().assignedToNames||[]).join(', ');return uids.length&&nm?'by '+nm:'';})(),ts:d.data().lastModifiedAt||d.data().createdAt})),
        ...finReqSnap2.docs.map(d=>({id:d.id,...d.data(),type:'finance-req',icon:'💼',label:'Finance Request',name:`Delete: ${d.data().userName||'?'} (${d.data().month||'?'})`,detail:`by ${d.data().requestedByName||'?'} — ${d.data().reason||''}`,ts:d.data().createdAt})),
        ...finDelSnap2.docs.map(d=>{const x=d.data();return {id:d.id,...x,type:'finance-del',icon:'🗑',label:'Finance Delete',name:`Delete: ${x.label||'record'}`,detail:`by ${x.requestedByName||'?'}${x.reason?' — '+x.reason:''}`,ts:x.createdAt,recLabel:x.label};}),
        // Partner quote approvals (partner submitted a quote for the president to review/edit/return).
        // approval_requests also hosts v12 WS22's ca_deduct requests — split by
        // `type` so those don't get mislabeled as quote approvals.
        ...qApprSnap2.docs.filter(d=>d.data().type!=='ca_deduct').map(d=>({id:d.id,...d.data(),type:'quote-approval',icon:'📤',label:'Quote Approval',name:`${d.data().quoteNumber||'Quote'} — ${d.data().clientName||''}`,detail:`${d.data().agentName||'Partner'} · ₱${fmt(d.data().total||0)}`,ts:d.data().createdAt})),
        ...qApprSnap2.docs.filter(d=>d.data().type==='ca_deduct').map(d=>{const x=d.data();return {id:d.id,...x,type:'ca_deduct',icon:'💳',label:'CA Deduction Request',name:x.userName||'Employee',detail:`₱${fmt(x.amount||0)} this month${x.reason?' — '+x.reason:''}`,ts:x.createdAt};}),
        // Quote delete requests (partner bs_quotes + internal bk_quotes + client folder) — president approves or denies
        ...delQSnap2.docs.map(d=>({id:d.id,...d.data(),type:'delete-quote',coll:'bs_quotes',icon:'🗑',label:'Quote Delete Request',name:`Delete quote ${d.data().quoteNumber||d.id.slice(-6)}`,detail:`${d.data().clientName||''}${d.data().deleteReason?' — '+d.data().deleteReason:''}`,ts:d.data().deleteRequestedAt})),
        // bk_quotes holds both Barro Kitchens and Barro Industries (general
        // fabrication) quotes, so the label comes from each doc's own company
        // code rather than being hardcoded "BK" for the whole collection —
        // the President needs to see WHICH quote they're approving a delete for.
        ...delBKQSnap2.docs.map(d=>{const x=d.data();const c=x.company||'BK';return {id:d.id,...x,type:'delete-quote',coll:'bk_quotes',icon:'🗑',label:`${c} Quote Delete Request`,name:`Delete ${c} quote ${x.quoteNumber||d.id.slice(-6)}`,detail:`${x.clientName||''}${x.deleteReason?' — '+x.deleteReason:''}`,ts:x.deleteRequestedAt};}),
        ...delCSnap2.docs.map(d=>({id:d.id,...d.data(),type:'delete-client',icon:'🗑',label:'Client Delete Request',name:`Delete client "${d.data().name||''}"`,detail:d.data().deleteReason||'',ts:d.data().deleteRequestedAt})),
        // Leave requests — surfaced here so every request type funnels through this page.
        ...leaveSnap2.docs.map(d=>{const x=d.data();return {id:d.id,...x,type:'leave',icon:'🌴',label:'Leave Request',name:x.userName||'Employee',detail:`${x.days||0}d ${x.type||'leave'} · ${x.startDate||''}→${x.endDate||''}${x.reason?' — '+x.reason:''}`,ts:x.createdAt};}),
        // v12 WS23 — raise requests from non-president finance/HR.
        ...raiseSnap2.docs.map(d=>{const x=d.data();return {id:d.id,...x,type:'raise',icon:'💸',label:'Raise Request',name:x.subjectName||'Employee',detail:`₱${fmt(x.oldAmount||0)} → ₱${fmt(x.newAmount||0)} · eff ${x.effectiveDate||''}${x.reason?' — '+x.reason:''}`,ts:x.createdAt};}),
        // v12 WS30 — POs awaiting the approval gate.
        ...poSnap2.docs.map(d=>{const x=d.data();return {id:d.id,...x,type:'po-approval',icon:'🛒',label:'PO Approval',name:`${x.prNo||x.rfqNo||'PO'} — ${x.supplier||'supplier'}`,detail:`${x.requestingDept||'Purchasing'} · ₱${fmt(x.total||0)}${x.title?' — '+x.title:''} · by ${x.convertedByName||x.createdByName||'?'}`,ts:x.convertedAt||x.createdAt};})
      ].sort((a,b)=>(b.ts?.seconds||0)-(a.ts?.seconds||0));

      if (!allPending.length) {
        wrap.innerHTML = `<div class="empty-state" style="padding:48px 16px"><div class="empty-icon">${emojiIcon('✅',44)}</div><h4>All clear!</h4><p>No pending requests at the moment.</p></div>`;
        if (window.lucide) lucide.createIcons({ nodes: [wrap] });
        return;
      }

      // v12 WS42 Phase 21 — approvals type badges get a colored icon-tile instead
      // of a bare emoji (color keyed by request type; money-moving = warning/danger
      // hues, everyday items = primary/info).
      const APPROVAL_TYPE_COLOR = {
        'signup':'#1971C2','attendance':'#0CA678','ca':'#F76707','ca_deduct':'#F76707',
        'submission':'#3B5BDB','review-task':'#3B5BDB','finance-req':'#D92D20','finance-del':'#D92D20',
        'quote-approval':'#7048E8','po-approval':'#099268','leave':'#2F9E44','raise':'#E64980',
        'delete-quote':'#D92D20','delete-client':'#D92D20'
      };
      wrap.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px">
          ${allPending.map(item => {
            const tileColor = APPROVAL_TYPE_COLOR[item.type] || 'var(--primary)';
            const tileIcon = window.LUCIDE_EMOJI_MAP[item.icon] || 'file-text';
            return `
          <div class="item-card pending-req-card" data-type="${item.type}" data-id="${item.id}" style="cursor:default">
            <div class="item-top">
              <div class="item-title" style="display:flex;align-items:center;gap:8px">${window.iconTile(tileIcon, tileColor, window.lightenHex(tileColor,18), 28)} ${escHtml(item.name)}</div>
              <span class="badge badge-warn">Pending</span>
            </div>
            <div class="item-meta" style="margin-top:4px">
              <span class="badge badge-blue" style="font-size:10px">${escHtml(item.label)}</span>
              ${item.detail?`<span style="font-size:12px;color:var(--text-muted)">${escHtml(item.detail)}</span>`:''}
              ${item.ts?`<span style="font-size:11px;color:var(--text-muted)">${new Date(item.ts.toDate()).toLocaleDateString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`:''}
            </div>
            <div style="display:flex;gap:8px;margin-top:10px" class="req-actions">
              ${ canActOn(item.type) ? (item.type==='signup'?`
                <button class="btn-success btn-sm sg-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name)}" data-email="${escHtml(item.email||'')}" data-phone="${escHtml(item.phone||'')}">${emojiIcon('✓',16)} Approve</button>
                <button class="btn-danger btn-sm sg-reject-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">${emojiIcon('✗',16)} Reject</button>
              `:item.type==='attendance'?`
                <button class="btn-success btn-sm at-approve-btn" data-id="${item.id}" data-uid="${item.uid||''}" data-name="${escHtml(item.name)}">${emojiIcon('✓',16)} Approve</button>
                <button class="btn-danger btn-sm at-deny-btn" data-id="${item.id}" data-uid="${item.uid||''}" data-name="${escHtml(item.name)}">${emojiIcon('✗',16)} Deny</button>
              `:item.type==='ca'?`
                <button class="btn-success btn-sm ca-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name)}" data-amount="${item.amount||0}" data-uid="${item.userId||''}">${emojiIcon('✓',16)} Approve CA</button>
                <button class="btn-danger btn-sm ca-reject-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">${emojiIcon('✗',16)} Reject</button>
              `:item.type==='ca_deduct'?`
                <button class="btn-success btn-sm cad-approve-btn" data-id="${item.id}" data-uid="${item.userId||''}" data-amount="${item.amount||0}">${emojiIcon('✓',16)} Approve</button>
                <button class="btn-danger btn-sm cad-reject-btn" data-id="${item.id}" data-uid="${item.userId||''}" data-amount="${item.amount||0}">${emojiIcon('✗',16)} Reject</button>
              `:item.type==='review-task'?`
                <button class="btn-primary btn-sm rt-view-btn" data-id="${item.id}">${emojiIcon('👁',16)} View Task</button>
                <button class="btn-success btn-sm rt-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">${emojiIcon('✓',16)} Approve</button>
                <button class="btn-danger btn-sm rt-reject-btn" data-id="${item.id}" data-name="${escHtml(item.name)}">${emojiIcon('✗',16)} Send Back</button>
              `:item.type==='finance-req'?`
                <button class="btn-success btn-sm fr-approve-btn" data-id="${item.id}" data-hist-id="${item.historyId||''}" data-name="${escHtml(item.userName||'')}" data-month="${item.month||''}" data-req-by="${item.requestedBy||''}">${emojiIcon('✓',16)} Approve Deletion</button>
                <button class="btn-danger btn-sm fr-deny-btn" data-id="${item.id}" data-name="${escHtml(item.userName||'')}" data-month="${item.month||''}" data-req-by="${item.requestedBy||''}">${emojiIcon('✗',16)} Deny</button>
              `:item.type==='finance-del'?`
                <button class="btn-success btn-sm fdel-approve-btn" data-id="${item.id}" data-coll="${escHtml(item.collection||'')}" data-doc="${escHtml(item.docId||'')}" data-label="${escHtml(item.recLabel||'record')}" data-req-by="${item.requestedBy||''}">${emojiIcon('✓',16)} Approve Deletion</button>
                <button class="btn-danger btn-sm fdel-deny-btn" data-id="${item.id}" data-label="${escHtml(item.recLabel||'record')}" data-req-by="${item.requestedBy||''}">${emojiIcon('✗',16)} Deny</button>
              `:item.type==='quote-approval'?`
                <button class="btn-primary btn-sm qa-review-btn" data-id="${item.id}" data-quote="${item.quoteId||''}" data-coll="${item.quoteColl||'bs_quotes'}" data-by="${item.agentId||''}" data-qno="${escHtml(item.quoteNumber||'')}" data-name="${escHtml(item.clientName||'')}">${emojiIcon('📝',16)} Open &amp; Edit</button>
                <button class="btn-success btn-sm qa-approve-btn" data-id="${item.id}" data-quote="${item.quoteId||''}" data-coll="${item.quoteColl||'bs_quotes'}" data-by="${item.agentId||''}" data-qno="${escHtml(item.quoteNumber||'')}" data-name="${escHtml(item.clientName||'')}">${emojiIcon('✓',16)} Approve</button>
                <button class="btn-danger btn-sm qa-return-btn" data-id="${item.id}" data-quote="${item.quoteId||''}" data-coll="${item.quoteColl||'bs_quotes'}" data-by="${item.agentId||''}" data-qno="${escHtml(item.quoteNumber||'')}" data-name="${escHtml(item.clientName||'')}">↩ Return to Partner</button>
              `:item.type==='delete-quote'?`
                <button class="btn-danger btn-sm dq-approve-btn" data-id="${item.id}" data-coll="${item.coll||'bs_quotes'}" data-qno="${escHtml(item.quoteNumber||'')}" data-by="${item.deleteRequestedBy||''}">${emojiIcon('✓',16)} Approve Delete</button>
                <button class="btn-secondary btn-sm dq-deny-btn" data-id="${item.id}" data-coll="${item.coll||'bs_quotes'}" data-qno="${escHtml(item.quoteNumber||'')}" data-by="${item.deleteRequestedBy||''}">${emojiIcon('✗',16)} Deny</button>
              `:item.type==='delete-client'?`
                <button class="btn-danger btn-sm dc-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name||'')}" data-by="${item.deleteRequestedBy||''}">${emojiIcon('✓',16)} Approve Delete</button>
                <button class="btn-secondary btn-sm dc-deny-btn" data-id="${item.id}" data-name="${escHtml(item.name||'')}" data-by="${item.deleteRequestedBy||''}">${emojiIcon('✗',16)} Deny</button>
              `:item.type==='raise'?`
                <button class="btn-success btn-sm rz-approve-btn" data-id="${item.id}">${emojiIcon('✓',16)} Approve</button>
                <button class="btn-danger btn-sm rz-reject-btn" data-id="${item.id}">${emojiIcon('✗',16)} Reject</button>
              `:item.type==='po-approval'?`
                <button class="btn-primary btn-sm po-view-btn" data-id="${item.id}">${emojiIcon('👁',16)} View PO</button>
                <button class="btn-success btn-sm po-approve-btn" data-id="${item.id}" data-no="${escHtml(item.prNo||'')}">${emojiIcon('✓',16)} Approve</button>
                <button class="btn-danger btn-sm po-reject-btn" data-id="${item.id}" data-no="${escHtml(item.prNo||'')}">${emojiIcon('✗',16)} Reject</button>
              `:item.type==='leave'?`
                <button class="btn-success btn-sm lv-approve-btn" data-id="${item.id}" data-name="${escHtml(item.name||'')}">${emojiIcon('✓',16)} Approve</button>
                <button class="btn-danger btn-sm lv-reject-btn" data-id="${item.id}" data-name="${escHtml(item.name||'')}">${emojiIcon('✗',16)} Reject</button>
              `:`
                <button class="btn-success btn-sm sub-approve-btn" data-id="${item.id}" data-uid="${item.createdBy||''}" data-title="${escHtml(item.title||item.name||'')}">${emojiIcon('✓',16)} Approve</button>
                <button class="btn-danger btn-sm sub-reject-btn" data-id="${item.id}" data-uid="${item.createdBy||''}" data-title="${escHtml(item.title||item.name||'')}">${emojiIcon('✗',16)} Reject</button>
              `) : ( canEscalate(item.type)
                ? `<button class="btn-secondary btn-sm esc-btn" data-label="${escHtml(item.label+' — '+item.name)}">${emojiIcon('🙋',16)} Request President approval</button>`
                : `<span class="badge badge-gray" style="font-size:11px">${emojiIcon('🔒',11)} ${['finance-req','finance-del','delete-quote','delete-client'].includes(item.type)?'President approval required':'President / Manager approves'}</span>`)}
            </div>
          </div>`;
          }).join('')}
        </div>`;
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });

      // Signup approve
      wrap.querySelectorAll('.sg-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          const { password: pwd } = await Approvals.dispatch('signup', 'approve', btn.dataset.id, {
            name: btn.dataset.name, email: btn.dataset.email, phone: btn.dataset.phone, currentUser
          });
          Notifs.success(`${btn.dataset.name} approved! Password: ${pwd}`);
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.sg-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!(await confirmDialog({message:`Reject ${escHtml(btn.dataset.name)}?`, html:true}))) return;
          await Approvals.dispatch('signup', 'reject', btn.dataset.id, {});
          loadApprovalsSub('all');
      }));

      // Attendance approve/deny — re-audit 2026-08-03: this used to hand-write a
      // hardcoded 2-hour extension with only a local toast, while the dedicated
      // Attendance sub-tab granted the canonical ATT_EXT_HOURS=6 and notified the
      // employee. Same request, two different outcomes depending on which tab was
      // clicked. Now routes through the exact same window.approveAttendanceExtension/
      // denyAttendanceExtension the Attendance sub-tab uses, so the grant length and
      // the employee notification are identical no matter which tab approved it.
      wrap.querySelectorAll('.at-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          await window.approveAttendanceExtension(btn.dataset.id, btn.dataset.uid, btn.dataset.name);
          Notifs.success(`Extension approved for ${btn.dataset.name}`);
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.at-deny-btn').forEach(btn => onClickSafe(btn, async () => {
          await window.denyAttendanceExtension(btn.dataset.id, btn.dataset.uid, btn.dataset.name);
          Notifs.error(`Extension denied for ${btn.dataset.name}`);
          loadApprovalsSub('all');
      }));

      // CA approve/reject
      // v12 WS22 — routes through the shared service (fixes: this approve used
      // to ignore totalPayable/interest, collecting strictly less than the
      // Cash Advance tab's own approve path for the same request).
      wrap.querySelectorAll('.ca-approve-btn').forEach(btn => {
        btn.addEventListener('click', () => window.CashAdvance.openApproveModal(btn.dataset.id, () => loadApprovalsSub('all')));
      });
      wrap.querySelectorAll('.ca-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          await window.CashAdvance.reject(btn.dataset.id);
          loadApprovalsSub('all');
      }));

      // CA deduction-for-this-run request (v12 WS22 decision 9) — approving just
      // flips status; CashAdvance.planFor() picks it up as that month's custom
      // amount the next time Compute runs for that employee's month.
      // Re-audit 2026-08-03: this only flipped approval_requests status and toasted
      // the approver, with no Notifs.send to the requesting employee — they'd only
      // find out indirectly via their payslip. Now notifies like every sibling
      // approve/reject handler on this page.
      wrap.querySelectorAll('.cad-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('approval_requests').doc(btn.dataset.id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (btn.dataset.uid) await safeNotify(() => Notifs.send(btn.dataset.uid, {
            title:'✅ CA Deduction Approved', body:`Your ₱${fmt(btn.dataset.amount)} cash advance deduction request was approved.`, icon:'✅', type:'ca_deduct_reviewed', link:'personal-finance'
          }));
          Notifs.success('CA deduction request approved.');
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.cad-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('approval_requests').doc(btn.dataset.id).update({ status:'rejected', rejectedBy:currentUser.uid, rejectedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (btn.dataset.uid) await safeNotify(() => Notifs.send(btn.dataset.uid, {
            title:'❌ CA Deduction Rejected', body:`Your ₱${fmt(btn.dataset.amount)} cash advance deduction request was rejected.`, icon:'❌', type:'ca_deduct_reviewed', link:'personal-finance'
          }));
          Notifs.error('CA deduction request rejected.');
          loadApprovalsSub('all');
      }));

      // Raise request approve/reject (v12 WS23) — re-entrancy guarded inside RaiseFlow itself.
      wrap.querySelectorAll('.rz-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          const r = await window.RaiseFlow.approve(btn.dataset.id);
          Notifs.showToast(r==='approved'?'Raise approved.':'Already resolved.');
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.rz-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          const reason = (await promptDialog({message:'Reason for declining (optional):', multiline:true}))||'';
          await window.RaiseFlow.reject(btn.dataset.id, reason);
          Notifs.error('Raise declined.');
          loadApprovalsSub('all');
      }));

      // PO approvals (v12 WS30) — same canonical service the Purchasing tab uses.
      wrap.querySelectorAll('.po-view-btn').forEach(btn => onClickSafe(btn, async () => {
          const s = await db.collection('purchase_requisitions').doc(btn.dataset.id).get();
          if (s.exists) printPurchaseOrder({ id: s.id, ...s.data() });   // pending → watermarked preview
      }));
      wrap.querySelectorAll('.po-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!(await confirmDialog({ message: `Approve PO ${escHtml(btn.dataset.no)}? Your name will print on the "Approved by" line.`, html: true }))) return;
          await window.approvePurchaseOrder(btn.dataset.id);
          Notifs.success('PO approved ✓');
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.po-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          const reason = await promptDialog({ title:'Reject PO', message:'Reason for rejection (shown to Purchasing):', multiline:true });
          if (reason === null) return;
          await window.rejectPurchaseOrder(btn.dataset.id, reason);
          Notifs.error('PO rejected.');
          loadApprovalsSub('all');
      }));

      // Submission approve/reject — re-audit 2026-08-03: this used to update the
      // submissions doc and only toast the approver, with no Notifs.send to the
      // creator (unlike openSubDetail's dedicated flow in tasks.js, which notifies
      // both ways). Employees who submit via the aggregated queue never heard back.
      wrap.querySelectorAll('.sub-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('submissions').doc(btn.dataset.id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (btn.dataset.uid) await safeNotify(() => Notifs.send(btn.dataset.uid, {
            title:'✅ Submission Approved', body:`"${btn.dataset.title}" was approved.`, icon:'✅', type:'submission_reviewed', link:'submissions'
          }));
          Notifs.success('Submission approved!');
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.sub-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          await db.collection('submissions').doc(btn.dataset.id).update({ status:'rejected', rejectedBy:currentUser.uid });
          if (btn.dataset.uid) await safeNotify(() => Notifs.send(btn.dataset.uid, {
            title:'❌ Submission Rejected', body:`"${btn.dataset.title}" was rejected.`, icon:'❌', type:'submission_reviewed', link:'submissions'
          }));
          Notifs.error('Submission rejected.');
          loadApprovalsSub('all');
      }));

      // Review task view/approve/reject
      wrap.querySelectorAll('.rt-view-btn').forEach(btn => {
        btn.addEventListener('click', () => openTaskDetail(btn.dataset.id, currentUser, currentRole));
      });
      wrap.querySelectorAll('.rt-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          // Payroll recall spec §A3.1 — completedAt alongside approvedAt so
          // month-scoped KPI (computeKpiForMonth via taskDoneMonth) can
          // resolve which month this task was actually approved/finished in.
          await db.collection('tasks').doc(btn.dataset.id).update({ status:'approved', approvedBy:currentUser.uid, approvedAt:firebase.firestore.FieldValue.serverTimestamp(), completedAt:firebase.firestore.FieldValue.serverTimestamp(), lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
          const snap2=await db.collection('tasks').doc(btn.dataset.id).get();
          if(snap2.exists){const t2=normTask(snap2.data(),snap2.id);await safeNotify(() => notifyTaskInvolved(t2,{title:'✅ Task Approved',body:`"${btn.dataset.name}" has been approved!`,icon:'✅',type:'task_status'},currentUser.uid));}
          Notifs.success(`"${btn.dataset.name}" approved!`);
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.rt-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          // Payroll recall spec §A3.1 — clear completedAt on send-back (this
          // review queue only ever acts on 'review'-status tasks, so this is
          // normally a no-op delete of an absent field; kept for safety if a
          // task somehow reaches here already carrying one).
          await db.collection('tasks').doc(btn.dataset.id).update({ status:'in-progress', completedAt:firebase.firestore.FieldValue.delete(), lastModifiedBy:currentUser.uid, lastModifiedAt:firebase.firestore.FieldValue.serverTimestamp() });
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
          const snap2=await db.collection('tasks').doc(btn.dataset.id).get();
          if(snap2.exists){const t2=normTask(snap2.data(),snap2.id);await safeNotify(() => notifyTaskInvolved(t2,{title:'🔁 Task Sent Back',body:`"${btn.dataset.name}" was sent back for revision.`,icon:'🔁',type:'task_status'},currentUser.uid));}
          Notifs.error(`"${btn.dataset.name}" sent back for revision.`);
          loadApprovalsSub('all');
      }));

      // Finance request approve/deny (from "all" view)
      wrap.querySelectorAll('.fr-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!(await confirmDialog({message:`Approve deletion of ${escHtml(btn.dataset.name)} (${btn.dataset.month}) payroll record?`, danger:true, html:true}))) return;
          btn.disabled = true;
          const r = await Approvals.dispatch('finance-req', 'approve', btn.dataset.id, {
            currentUser, histId: btn.dataset.histId, name: btn.dataset.name, month: btn.dataset.month, reqBy: btn.dataset.reqBy
          });
          if (r.already) { Notifs.showToast('Already handled.'); loadApprovalsSub('all'); return; }
          Notifs.success('Record deleted and requester notified.');
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.fr-deny-btn').forEach(btn => onClickSafe(btn, async () => {
          await Approvals.dispatch('finance-req', 'deny', btn.dataset.id, {
            currentUser, name: btn.dataset.name, month: btn.dataset.month, reqBy: btn.dataset.reqBy
          });
          Notifs.error('Request denied and requester notified.');
          loadApprovalsSub('all');
      }));

      // Generic finance delete request approve/deny (from "all" view)
      wrap.querySelectorAll('.fdel-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!(await confirmDialog({message:`Approve deletion of ${escHtml(btn.dataset.label)}? This permanently deletes it.`, danger:true, html:true}))) return;
          btn.disabled = true;
          const r = await Approvals.dispatch('finance-del', 'approve', btn.dataset.id, {
            currentUser, coll: btn.dataset.coll, docId: btn.dataset.doc, label: btn.dataset.label, reqBy: btn.dataset.reqBy
          });
          if (r.already) { Notifs.showToast('Already handled.'); loadApprovalsSub('all'); return; }
          Notifs.success('Deleted and requester notified.');
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.fdel-deny-btn').forEach(btn => onClickSafe(btn, async () => {
          await Approvals.dispatch('finance-del', 'deny', btn.dataset.id, {
            currentUser, label: btn.dataset.label, reqBy: btn.dataset.reqBy
          });
          Notifs.error('Request denied and requester notified.');
          loadApprovalsSub('all');
      }));

      // ── Partner quote approvals — open & edit, approve, or return to partner ──
      wrap.querySelectorAll('.qa-review-btn').forEach(btn => onClickSafe(btn, () => {
        openQuoteApprovalReview({ quoteId:btn.dataset.quote, agentId:btn.dataset.by, quoteNumber:btn.dataset.qno, clientName:btn.dataset.name, quoteColl:btn.dataset.coll }, ()=>loadApprovalsSub('all'));
      }));
      wrap.querySelectorAll('.qa-approve-btn').forEach(btn => onClickSafe(btn, async () => {
        await approveQuoteApproval(btn.dataset.quote, btn.dataset.by, btn.dataset.qno, btn.dataset.name, btn.dataset.coll);
        loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.qa-return-btn').forEach(btn => onClickSafe(btn, async () => {
        const notes = (await promptDialog({message:'Notes for the partner (what to revise)?', multiline:true}))||'';
        await returnQuoteToPartner(btn.dataset.quote, btn.dataset.by, btn.dataset.qno, btn.dataset.name, notes, btn.dataset.coll);
        loadApprovalsSub('all');
      }));

      // ── Quote delete requests — approve (delete) or deny (clear flag) ──
      // Collection-aware: bs_quotes (partner) and bk_quotes (internal Sales).
      wrap.querySelectorAll('.dq-approve-btn').forEach(btn => onClickSafe(btn, async () => {
        if (!(await confirmDialog({message:`Approve deletion of quote ${btn.dataset.qno}? This permanently removes it.`, danger:true}))) return;
        const coll = btn.dataset.coll || 'bs_quotes';
        try {
          await db.collection(coll).doc(btn.dataset.id).delete();
          window.logAudit && window.logAudit('delete','quote',btn.dataset.id,{ quoteNo:btn.dataset.qno, coll, viaApproval:true });
          if (btn.dataset.by) await safeNotify(()=>Notifs.send(btn.dataset.by, { title:'🗑 Quote Deletion Approved', body:`Your request to delete quote ${btn.dataset.qno} was approved.`, icon:'✅', type:'delete_approved', link:'approvals' }));
          Notifs.success('Quote deleted.'); loadApprovalsSub('all');
        } catch(ex){ Notifs.showToast('Delete failed: '+(ex.message||ex.code),'error'); }
      }));
      wrap.querySelectorAll('.dq-deny-btn').forEach(btn => onClickSafe(btn, async () => {
        const coll = btn.dataset.coll || 'bs_quotes';
        try {
          await db.collection(coll).doc(btn.dataset.id).update({ deleteRequested:firebase.firestore.FieldValue.delete(), deleteReason:firebase.firestore.FieldValue.delete() });
          if (btn.dataset.by) await safeNotify(()=>Notifs.send(btn.dataset.by, { title:'Quote Deletion Denied', body:`Your request to delete quote ${btn.dataset.qno} was denied.`, icon:'❌', type:'delete_denied', link:'approvals' }));
          Notifs.error('Delete request denied.'); loadApprovalsSub('all');
        } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
      }));
      wrap.querySelectorAll('.dc-approve-btn').forEach(btn => onClickSafe(btn, async () => {
        if (!(await confirmDialog({message:`Approve deletion of client "${escHtml(btn.dataset.name)}"? This permanently removes the client folder.`, danger:true, html:true}))) return;
        try {
          await db.collection('clients').doc(btn.dataset.id).delete();
          if (typeof dbCacheInvalidate==='function') dbCacheInvalidate('clients');
          window.logAudit && window.logAudit('delete','client',btn.dataset.id,{ name:btn.dataset.name, viaApproval:true });
          if (btn.dataset.by) await safeNotify(()=>Notifs.send(btn.dataset.by, { title:'🗑 Client Deletion Approved', body:`Your request to delete client "${btn.dataset.name}" was approved.`, icon:'✅', type:'delete_approved', link:'approvals' }));
          Notifs.success('Client deleted.'); loadApprovalsSub('all');
        } catch(ex){ Notifs.showToast('Delete failed: '+(ex.message||ex.code),'error'); }
      }));
      wrap.querySelectorAll('.dc-deny-btn').forEach(btn => onClickSafe(btn, async () => {
        try {
          await db.collection('clients').doc(btn.dataset.id).update({ deleteRequested:firebase.firestore.FieldValue.delete(), deleteReason:firebase.firestore.FieldValue.delete() });
          if (typeof dbCacheInvalidate==='function') dbCacheInvalidate('clients');
          if (btn.dataset.by) await safeNotify(()=>Notifs.send(btn.dataset.by, { title:'Client Deletion Denied', body:`Your request to delete client "${btn.dataset.name}" was denied.`, icon:'❌', type:'delete_denied', link:'approvals' }));
          Notifs.error('Delete request denied.'); loadApprovalsSub('all');
        } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
      }));

      // Leave approve/reject — uses the helpers exposed by modules.js so leave
      // balances are debited consistently with the Leave Management screen.
      wrap.querySelectorAll('.lv-approve-btn').forEach(btn => onClickSafe(btn, async () => {
        await Approvals.dispatch('leave', 'approve', btn.dataset.id, {});
        Notifs.success(`Leave approved for ${btn.dataset.name}`);
        loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.lv-reject-btn').forEach(btn => onClickSafe(btn, async () => {
        const reason = (await promptDialog({message:'Reason for rejection (optional):', multiline:true}))||'';
        await Approvals.dispatch('leave', 'reject', btn.dataset.id, { reason });
        Notifs.error(`Leave rejected for ${btn.dataset.name}`);
        loadApprovalsSub('all');
      }));

      // Secretary escalation — ping the President to review a major item.
      wrap.querySelectorAll('.esc-btn').forEach(btn => onClickSafe(btn, async () => {
        btn.disabled = true;
        await requestPresidentApproval(btn.dataset.label || 'a request');
      }));
      return;
    }

    if (sub === 'grading') {
      // ── President's grading queue ──────────────────────────────────────
      // Two things await the President's grade, consolidated here:
      //  1. Completed/approved tasks with no presidentScore (quality 1–10).
      //  2. Employees whose monthly self-assessment (selfGrade) awaits the
      //     president's KPI grade (presidentGrade).
      if (!_showGrading) { wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🔒',44)}</div><h4>Grading is President / Manager only</h4></div>`; return; }
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
      const [taskSnap, evalSnap, usersSnap] = await Promise.all([
        db.collection('tasks').where('status','in',['approved','completed','done']).get().catch(()=>({docs:[]})),
        db.collection('kpi_evals').get().catch(()=>({docs:[]})),
        dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]}))
      ]);
      const userName = {};
      (usersSnap.docs||[]).forEach(d=>{ const u=d.data(); userName[d.id] = u.displayName || u.email || 'Employee'; });
      const ungradedTasks = (taskSnap.docs||[])
        .map(d=>({id:d.id,...d.data()}))
        .filter(t=>typeof t.presidentScore !== 'number')
        .sort((a,b)=>((b.approvedAt||b.lastModifiedAt)?.seconds||0)-((a.approvedAt||a.lastModifiedAt)?.seconds||0));
      const ungradedKpi = (evalSnap.docs||[])
        .map(d=>({uid:d.id,...d.data()}))
        .filter(e=>e.selfGrade!=null && e.presidentGrade==null);

      if (!ungradedTasks.length && !ungradedKpi.length) {
        wrap.innerHTML = `<div class="empty-state" style="padding:48px 16px"><div class="empty-icon">${emojiIcon('⭐',44)}</div><h4>Nothing to grade</h4><p>All completed tasks are scored and every self-assessment is graded.</p></div>`;
        if (window.lucide) lucide.createIcons({ nodes: [wrap] });
        return;
      }
      const canGrade = (_role === 'president'); // KPI grade write is President's call
      wrap.innerHTML = `
        ${ungradedKpi.length?`
        <h4 style="margin:4px 0 8px;font-size:14px">${emojiIcon('📊',14)} Self-assessments awaiting your grade (${ungradedKpi.length})</h4>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
          ${ungradedKpi.map(e=>`
            <div class="item-card" style="cursor:default">
              <div class="item-top">
                <div class="item-title">${emojiIcon('📊',16)} ${escHtml(userName[e.uid]||'Employee')}</div>
                <span class="badge badge-warn">Self: ${escHtml(e.selfGrade)}/10</span>
              </div>
              <div class="item-meta" style="margin-top:4px">
                ${e.selfNotes?`<span style="font-size:12px;color:var(--text-muted)">${escHtml(e.selfNotes)}</span>`:'<span style="font-size:12px;color:var(--text-muted)">No notes</span>'}
              </div>
              ${canGrade?`<div style="margin-top:10px"><button class="btn-primary btn-sm grade-kpi-btn" data-uid="${e.uid}" data-name="${escHtml(userName[e.uid]||'Employee')}">${emojiIcon('⭐',16)} Grade</button></div>`:''}
            </div>`).join('')}
        </div>`:''}
        ${ungradedTasks.length?`
        <h4 style="margin:4px 0 8px;font-size:14px">${emojiIcon('📋',14)} Completed tasks awaiting a score (${ungradedTasks.length})</h4>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${ungradedTasks.map(t=>{
            const names = (t.assignedToNames||[]).join(', ') || 'Unassigned';
            return `<div class="item-card" style="cursor:default">
              <div class="item-top">
                <div class="item-title">${emojiIcon('📋',16)} ${escHtml(t.title||'Untitled Task')}</div>
                <span class="badge badge-gray">Unscored</span>
              </div>
              <div class="item-meta" style="margin-top:4px;gap:6px">
                ${t.department?`<span class="badge badge-blue" style="font-size:10px">${escHtml(t.department)}</span>`:''}
                <span style="font-size:12px;color:var(--text-muted)">by ${escHtml(names)}</span>
              </div>
              <div style="margin-top:10px"><button class="btn-primary btn-sm grade-task-btn" data-id="${t.id}">${emojiIcon('⭐',16)} Open &amp; Score</button></div>
            </div>`;
          }).join('')}
        </div>`:''}`;
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });

      wrap.querySelectorAll('.grade-task-btn').forEach(btn=>btn.addEventListener('click',()=>openTaskDetail(btn.dataset.id, currentUser, _role)));
      wrap.querySelectorAll('.grade-kpi-btn').forEach(btn=>btn.addEventListener('click',()=>{
        const { uid, name } = btn.dataset;
        openPage(`${emojiIcon('⭐',16)} Grade: ${escHtml(name||'')}`, `
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Assign a performance grade for ${escHtml(name)} (1 = poor, 10 = outstanding). Development areas are shown to the employee.</p>
          <div class="form-group"><label>President Grade (1–10)</label>
            <input id="ap-grade-input" type="number" inputmode="numeric" min="1" max="10" step="1" placeholder="e.g. 8"/></div>
          <div class="form-group"><label>General Notes (internal only)</label>
            <textarea id="ap-grade-notes" rows="2" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical" placeholder="Internal remarks…"></textarea></div>
          <div class="form-group"><label>${emojiIcon('📝',16)} Development Areas <span style="font-size:11px;color:var(--primary-light)">(shown to employee)</span></label>
            <textarea id="ap-improve-input" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical" placeholder="What should this employee focus on improving?"></textarea></div>
        `, `<button class="btn-primary" id="ap-save-grade-btn">Save Grade</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
        document.getElementById('ap-save-grade-btn')?.addEventListener('click', async ()=>{
          const grade   = parseInt(document.getElementById('ap-grade-input').value);
          const notes   = document.getElementById('ap-grade-notes').value.trim();
          const improve = document.getElementById('ap-improve-input').value.trim();
          if (!grade || grade < 1 || grade > 10) { Notifs.showToast('Enter 1–10.','error'); return; }
          await db.collection('kpi_evals').doc(uid).set({
            presidentGrade: grade, presidentNotes: notes, presidentImprovements: improve,
            presidentId: currentUser.uid, presidentUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('kpi-evals');
          await safeNotify(()=>Notifs.send(uid, { title:'📊 KPI Grade Updated', body: improve?`The president graded your performance: ${grade}/10. See your Personal Finance page for development areas.`:`The president graded your performance: ${grade}/10.`, icon:'📊', type:'kpi_grade' }));
          closeModal(); Notifs.success(`Grade ${grade}/10 saved for ${name}.`);
          loadApprovalsSub('grading');
        });
      }));
      return;
    }

    if (sub === 'history') {
      // ── Unified History (read-only) ────────────────────────────────────
      // Recently RESOLVED items (approved/rejected/denied) across the same
      // collections the 'all' tab sources from, so decided items don't sit
      // in the pending queue forever but are still auditable. Capped at 100,
      // newest first, 30-day lookback, no action buttons.
      const cutoff = new Date(Date.now() - 30*24*60*60*1000);
      const RESOLVED = new Set(['approved','rejected','denied','applied']);
      const [sgH, atH, caH, subH, frH, fdH, qaH, lvH, rzH, poH] = await Promise.all([
        db.collection('signup_requests').orderBy('createdAt','desc').limit(150).get().catch(()=>({docs:[]})),
        db.collection('attendance_extensions').orderBy('requestedAt','desc').limit(150).get().catch(()=>({docs:[]})),
        db.collection('cash_advances').orderBy('createdAt','desc').limit(150).get().catch(()=>({docs:[]})),
        db.collection('submissions').orderBy('createdAt','desc').limit(150).get().catch(()=>({docs:[]})),
        db.collection('payroll_delete_requests').orderBy('createdAt','desc').limit(150).get().catch(()=>({docs:[]})),
        db.collection('finance_delete_requests').orderBy('createdAt','desc').limit(150).get().catch(()=>({docs:[]})),
        db.collection('approval_requests').orderBy('createdAt','desc').limit(150).get().catch(()=>({docs:[]})),
        db.collection('leave_requests').orderBy('createdAt','desc').limit(150).get().catch(()=>({docs:[]})),
        db.collection('pending_raises').orderBy('createdAt','desc').limit(150).get().catch(()=>({docs:[]})),
        db.collection('purchase_requisitions').orderBy('createdAt','desc').limit(150).get().catch(()=>({docs:[]}))
      ]);
      const tsOf = x => (x.resolvedAt || x.approvedAt || x.decidedAt || x.updatedAt || x.createdAt);
      const mk = (d, type, icon, label, name, detail) => {
        const x = d.data(); const ts = tsOf(x);
        return { id:d.id, type, icon, label, name, detail, status:(x.status||x.approvalStatus||(x.deleteRequested===false?'approved':'')), ts };
      };
      const HIST_TYPE_COLOR = {
        'signup':'#1971C2','attendance':'#0CA678','ca':'#F76707','ca_deduct':'#F76707',
        'submission':'#3B5BDB','finance-req':'#D92D20','finance-del':'#D92D20',
        'quote-approval':'#7048E8','po-approval':'#099268','leave':'#2F9E44','raise':'#E64980'
      };
      let items = [
        ...sgH.docs.map(d=>mk(d,'signup','👤','Sign-up Request', d.data().fullName||d.data().email||'Unknown', d.data().email||'')),
        ...atH.docs.map(d=>mk(d,'attendance','⏰','Attendance Extension', d.data().userName||'Unknown', d.data().date||'')),
        ...caH.docs.map(d=>mk(d,'ca','💸','Cash Advance', d.data().userName||'Unknown', `₱${fmt(d.data().amount||0)}`)),
        ...subH.docs.map(d=>mk(d,'submission','📤','Work Submission', d.data().submittedByName||d.data().userName||d.data().authorName||'Unknown', d.data().title||'')),
        ...frH.docs.map(d=>mk(d,'finance-req','💼','Finance Request', `Delete: ${d.data().userName||'?'} (${d.data().month||'?'})`, `by ${d.data().requestedByName||'?'}`)),
        ...fdH.docs.map(d=>mk(d,'finance-del','🗑','Finance Delete', `Delete: ${d.data().label||'record'}`, `by ${d.data().requestedByName||'?'}`)),
        ...qaH.docs.filter(d=>d.data().type!=='ca_deduct').map(d=>mk(d,'quote-approval','📤','Quote Approval', `${d.data().quoteNumber||'Quote'} — ${d.data().clientName||''}`, `${d.data().agentName||'Partner'} · ₱${fmt(d.data().total||0)}`)),
        ...qaH.docs.filter(d=>d.data().type==='ca_deduct').map(d=>mk(d,'ca_deduct','💳','CA Deduction Request', d.data().userName||'Employee', `₱${fmt(d.data().amount||0)}`)),
        ...lvH.docs.map(d=>mk(d,'leave','🌴','Leave Request', d.data().userName||'Employee', `${d.data().days||0}d ${d.data().type||'leave'}`)),
        ...rzH.docs.map(d=>mk(d,'raise','💸','Raise Request', d.data().subjectName||'Employee', `₱${fmt(d.data().oldAmount||0)} → ₱${fmt(d.data().newAmount||0)}`)),
        ...poH.docs.map(d=>mk(d,'po-approval','🛒','PO Approval', `${d.data().prNo||d.data().rfqNo||'PO'} — ${d.data().supplier||'supplier'}`, `${d.data().requestingDept||'Purchasing'} · ₱${fmt(d.data().total||0)}`))
      ]
        .filter(it => RESOLVED.has((it.status||'').toLowerCase()) && it.ts && it.ts.toDate && it.ts.toDate() >= cutoff)
        .sort((a,b)=>(b.ts?.seconds||0)-(a.ts?.seconds||0))
        .slice(0,100);

      if (!items.length) {
        wrap.innerHTML = `<div class="empty-state" style="padding:48px 16px"><div class="empty-icon">${emojiIcon('🗄️',44)}</div><h4>Nothing resolved yet</h4><p>Approved, rejected, or denied requests from the last 30 days will show up here.</p></div>`;
        if (window.lucide) lucide.createIcons({ nodes: [wrap] });
        return;
      }
      wrap.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px">
          ${items.map(item => {
            const tileColor = HIST_TYPE_COLOR[item.type] || 'var(--primary)';
            const tileIcon = window.LUCIDE_EMOJI_MAP[item.icon] || 'file-text';
            const st = (item.status||'').toLowerCase();
            const badgeCls = (st==='approved'||st==='applied') ? 'badge-green' : 'badge-red';
            const badgeLbl = st==='applied' ? 'Approved' : st==='approved' ? 'Approved' : (st==='denied' ? 'Denied' : 'Rejected');
            return `
          <div class="item-card" style="cursor:default">
            <div class="item-top">
              <div class="item-title" style="display:flex;align-items:center;gap:8px">${window.iconTile(tileIcon, tileColor, window.lightenHex(tileColor,18), 28)} ${escHtml(item.name)}</div>
              <span class="badge ${badgeCls}">${badgeLbl}</span>
            </div>
            <div class="item-meta" style="margin-top:4px">
              <span class="badge badge-blue" style="font-size:10px">${escHtml(item.label)}</span>
              ${item.detail?`<span style="font-size:12px;color:var(--text-muted)">${escHtml(item.detail)}</span>`:''}
              ${item.ts?`<span style="font-size:11px;color:var(--text-muted)">${new Date(item.ts.toDate()).toLocaleDateString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`:''}
            </div>
          </div>`;
          }).join('')}
        </div>`;
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
      return;
    }

    if (sub === 'finance-requests') {
      const [psnap, fsnap] = await Promise.all([
        db.collection('payroll_delete_requests').orderBy('createdAt','desc').limit(100).get().catch(e=>{console.error('payroll_delete_requests query failed',e);return {docs:[]};}),
        db.collection('finance_delete_requests').orderBy('createdAt','desc').limit(100).get().catch(e=>{console.error('finance_delete_requests query failed',e);return {docs:[]};})
      ]);
      const reqs = [
        ...psnap.docs.map(d=>({id:d.id,kind:'payroll',...d.data()})),
        ...fsnap.docs.map(d=>({id:d.id,kind:'finance',...d.data()}))
      ].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      const pending = reqs.filter(r=>r.status==='pending');
      const resolved = reqs.filter(r=>r.status!=='pending');

      const titleOf = r => r.kind==='payroll'
        ? `${emojiIcon('🗑',16)} Delete Payroll Record — ${escHtml(r.userName||'?')} (${r.month||'?'})`
        : `${emojiIcon('🗑',16)} Delete — ${escHtml(r.label||'record')}`;
      const actionsOf = r => r.kind==='payroll'
        ? `<button class="btn-success btn-sm fr-approve-btn" data-id="${r.id}" data-hist-id="${r.historyId||''}" data-name="${escHtml(r.userName||'')}" data-month="${r.month||''}" data-req-by="${r.requestedBy||''}">${emojiIcon('✓',16)} Approve Deletion</button>
           <button class="btn-danger btn-sm fr-deny-btn" data-id="${r.id}" data-name="${escHtml(r.userName||'')}" data-month="${r.month||''}" data-req-by="${r.requestedBy||''}">${emojiIcon('✗',16)} Deny</button>`
        : `<button class="btn-success btn-sm fdel-approve-btn" data-id="${r.id}" data-coll="${escHtml(r.collection||'')}" data-doc="${escHtml(r.docId||'')}" data-label="${escHtml(r.label||'record')}" data-req-by="${r.requestedBy||''}">${emojiIcon('✓',16)} Approve Deletion</button>
           <button class="btn-danger btn-sm fdel-deny-btn" data-id="${r.id}" data-label="${escHtml(r.label||'record')}" data-req-by="${r.requestedBy||''}">${emojiIcon('✗',16)} Deny</button>`;
      const reqCard = (r, showActions) => `
        <div class="item-card" style="cursor:default">
          <div class="item-top">
            <div class="item-title">${titleOf(r)}</div>
            <span class="badge ${r.status==='pending'?'badge-warn':r.status==='approved'?'badge-green':'badge-red'}">${r.status==='pending'?'Pending':r.status==='approved'?'Approved':'Denied'}</span>
          </div>
          <div class="item-meta" style="margin-top:4px;flex-wrap:wrap;gap:6px">
            <span class="badge badge-blue" style="font-size:10px">${r.kind==='payroll'?'Payroll Delete':'Finance Delete'}</span>
            <span style="font-size:12px;color:var(--text-muted)">Requested by: <strong>${escHtml(r.requestedByName||'?')}</strong></span>
            ${r.reason?`<span style="font-size:12px;color:var(--text-muted)">Reason: ${escHtml(r.reason)}</span>`:''}
            ${r.createdAt?`<span style="font-size:11px;color:var(--text-muted)">${new Date(r.createdAt.toDate()).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`:''}
          </div>
          ${showActions?`<div style="display:flex;gap:8px;margin-top:10px">${actionsOf(r)}</div>`:''}
        </div>`;

      wrap.innerHTML = `
        ${!pending.length && !resolved.length ? `<div class="empty-state" style="padding:48px 16px"><div class="empty-icon">${emojiIcon('💼',44)}</div><h4>No finance requests</h4></div>` : ''}
        ${pending.length ? `<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Pending (${pending.length})</h4>
          <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
            ${pending.map(r=>reqCard(r,canDelete)).join('')}
          </div>` : ''}
        ${resolved.length ? `<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">History</h4>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${resolved.slice(0,20).map(r=>reqCard(r,false)).join('')}
          </div>` : ''}
      `;
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });

      wrap.querySelectorAll('.fr-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!(await confirmDialog({message:`Approve deletion of ${escHtml(btn.dataset.name)} (${btn.dataset.month}) payroll record?`, danger:true, html:true}))) return;
          btn.disabled = true;
          const r = await Approvals.dispatch('finance-req', 'approve', btn.dataset.id, {
            currentUser, histId: btn.dataset.histId, name: btn.dataset.name, month: btn.dataset.month, reqBy: btn.dataset.reqBy
          });
          if (r.already) { Notifs.showToast('Already handled.'); loadApprovalsSub('finance-requests'); return; }
          Notifs.success('Record deleted and requester notified.');
          loadApprovalsSub('finance-requests');
      }));
      wrap.querySelectorAll('.fr-deny-btn').forEach(btn => onClickSafe(btn, async () => {
          await Approvals.dispatch('finance-req', 'deny', btn.dataset.id, {
            currentUser, name: btn.dataset.name, month: btn.dataset.month, reqBy: btn.dataset.reqBy
          });
          Notifs.error('Request denied.');
          loadApprovalsSub('finance-requests');
      }));
      wrap.querySelectorAll('.fdel-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!(await confirmDialog({message:`Approve deletion of ${escHtml(btn.dataset.label)}? This permanently deletes it.`, danger:true, html:true}))) return;
          btn.disabled = true;
          const r = await Approvals.dispatch('finance-del', 'approve', btn.dataset.id, {
            currentUser, coll: btn.dataset.coll, docId: btn.dataset.doc, label: btn.dataset.label, reqBy: btn.dataset.reqBy
          });
          if (r.already) { Notifs.showToast('Already handled.'); loadApprovalsSub('finance-requests'); return; }
          Notifs.success('Deleted and requester notified.');
          loadApprovalsSub('finance-requests');
      }));
      wrap.querySelectorAll('.fdel-deny-btn').forEach(btn => onClickSafe(btn, async () => {
          await Approvals.dispatch('finance-del', 'deny', btn.dataset.id, {
            currentUser, label: btn.dataset.label, reqBy: btn.dataset.reqBy
          });
          Notifs.error('Request denied and requester notified.');
          loadApprovalsSub('finance-requests');
      }));
      return;
    }

    if (sub === 'leave') {
      const snap = await db.collection('leave_requests').orderBy('createdAt','desc').limit(200).get().catch(()=>({docs:[]}));
      const reqs = snap.docs.map(d=>({id:d.id,...d.data()}));
      const pending = reqs.filter(r=>r.status==='pending');
      const resolved = reqs.filter(r=>r.status!=='pending');
      const card = (r, showActions) => `
        <div class="item-card" style="cursor:default">
          <div class="item-top">
            <div class="item-title">${emojiIcon('🌴',16)} ${escHtml(r.userName||'Employee')}</div>
            <span class="badge ${r.status==='pending'?'badge-warn':r.status==='approved'?'badge-green':'badge-red'}">${r.status==='pending'?'Pending':r.status==='approved'?'Approved':'Rejected'}</span>
          </div>
          <div class="item-meta" style="margin-top:4px;flex-wrap:wrap;gap:6px">
            <span class="badge badge-blue" style="font-size:10px">${escHtml(r.type||'leave')}</span>
            <span style="font-size:12px;color:var(--text-muted)">${r.days||0} day${(r.days||0)!==1?'s':''} · ${escHtml(r.startDate||'')} → ${escHtml(r.endDate||'')}</span>
            ${r.reason?`<span style="font-size:12px;color:var(--text-muted)">${escHtml(r.reason)}</span>`:''}
          </div>
          ${showActions?`<div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn-success btn-sm lv-approve-btn" data-id="${r.id}" data-name="${escHtml(r.userName||'')}">${emojiIcon('✓',16)} Approve</button>
            <button class="btn-danger btn-sm lv-reject-btn" data-id="${r.id}" data-name="${escHtml(r.userName||'')}">${emojiIcon('✗',16)} Reject</button>
          </div>`:''}
        </div>`;
      wrap.innerHTML = `
        ${!pending.length && !resolved.length ? `<div class="empty-state" style="padding:48px 16px"><div class="empty-icon">${emojiIcon('🌴',44)}</div><h4>No leave requests</h4></div>` : ''}
        ${pending.length?`<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Pending (${pending.length})</h4>
          <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">${pending.map(r=>card(r,canAct)).join('')}</div>`:''}
        ${resolved.length?`<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">History</h4>
          <div style="display:flex;flex-direction:column;gap:10px">${resolved.slice(0,20).map(r=>card(r,false)).join('')}</div>`:''}`;
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
      wrap.querySelectorAll('.lv-approve-btn').forEach(btn => onClickSafe(btn, async () => {
        await Approvals.dispatch('leave', 'approve', btn.dataset.id, {});
        Notifs.success(`Leave approved for ${btn.dataset.name}`);
        loadApprovalsSub('leave');
      }));
      wrap.querySelectorAll('.lv-reject-btn').forEach(btn => onClickSafe(btn, async () => {
        const reason = (await promptDialog({message:'Reason for rejection (optional):', multiline:true}))||'';
        await Approvals.dispatch('leave', 'reject', btn.dataset.id, { reason });
        Notifs.error(`Leave rejected for ${btn.dataset.name}`);
        loadApprovalsSub('leave');
      }));
      return;
    }

    if (sub === 'review-tasks') {
      const snap = await db.collection('tasks').where('status','==','review').orderBy('lastModifiedAt','desc').get().catch(()=>({docs:[]}));
      const tasks = snap.docs.map(d=>({id:d.id,...d.data()}));
      if (!tasks.length) {
        wrap.innerHTML = `<div class="empty-state" style="padding:48px 16px"><div class="empty-icon">${emojiIcon('✅',44)}</div><h4>No tasks awaiting review</h4></div>`;
        if (window.lucide) lucide.createIcons({ nodes: [wrap] });
        return;
      }
      wrap.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">
        ${tasks.map(t=>{
          const names = (t.assignedToNames||[]).join(', ') || (Array.isArray(t.assignedTo)?t.assignedTo:[t.assignedTo]).filter(Boolean).join(', ') || 'Unassigned';
          const dept  = t.department || '';
          const ts    = t.lastModifiedAt||t.createdAt;
          return `<div class="item-card" style="cursor:default">
            <div class="item-top">
              <div class="item-title">${emojiIcon('📋',16)} ${escHtml(t.title||'Untitled Task')}</div>
              <span class="badge badge-warn">For Review</span>
            </div>
            <div class="item-meta" style="margin-top:4px;gap:6px">
              ${dept?`<span class="badge badge-blue" style="font-size:10px">${escHtml(dept)}</span>`:''}
              <span style="font-size:12px;color:var(--text-muted)">by ${escHtml(names)}</span>
              ${ts?`<span style="font-size:11px;color:var(--text-muted)">${new Date(ts.toDate()).toLocaleDateString('en-PH',{month:'short',day:'numeric'})}</span>`:''}
            </div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn-primary btn-sm rt-view-btn" data-id="${t.id}">${emojiIcon('👁',16)} View</button>
              ${canActOn('review-task')?`<button class="btn-success btn-sm rt-approve-btn" data-id="${t.id}" data-name="${escHtml(t.title||'Task')}">${emojiIcon('✓',16)} Approve</button>
              <button class="btn-danger btn-sm rt-reject-btn" data-id="${t.id}" data-name="${escHtml(t.title||'Task')}">${emojiIcon('✗',16)} Send Back</button>`:''}
            </div>
          </div>`;
        }).join('')}
      </div>`;
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
      wrap.querySelectorAll('.rt-view-btn').forEach(btn=>btn.addEventListener('click',()=>openTaskDetail(btn.dataset.id,currentUser,window.currentRole||'president')));
      // Re-audit 2026-08-03: this dedicated tab updated the task doc and only
      // toasted the approver — no notifyTaskInvolved call — while the byte-similar
      // handlers in the aggregated "All Requests" view (.rt-approve-btn/.rt-reject-btn
      // above) do notify. Same task-review action, same collection, whether the
      // assignee hears back depended on which Approvals tab was used. Now matches.
      wrap.querySelectorAll('.rt-approve-btn').forEach(btn=>btn.addEventListener('click',async()=>{
        if (!(await confirmDialog({message:`Approve "${escHtml(btn.dataset.name)}"?`, html:true}))) return;
        // Payroll recall spec §A3.1 — completedAt alongside approvedAt (see
        // the aggregated "All Requests" .rt-approve-btn handler above).
        await db.collection('tasks').doc(btn.dataset.id).update({status:'approved',approvedAt:firebase.firestore.FieldValue.serverTimestamp(),completedAt:firebase.firestore.FieldValue.serverTimestamp(),approvedBy:currentUser.uid});
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
        const snap2=await db.collection('tasks').doc(btn.dataset.id).get();
        if(snap2.exists){const t2=normTask(snap2.data(),snap2.id);await safeNotify(() => notifyTaskInvolved(t2,{title:'✅ Task Approved',body:`"${btn.dataset.name}" has been approved!`,icon:'✅',type:'task_status'},currentUser.uid));}
        Notifs.showToast(`"${btn.dataset.name}" approved!`,'success');
        loadApprovalsSub('review-tasks');
      }));
      wrap.querySelectorAll('.rt-reject-btn').forEach(btn=>btn.addEventListener('click',async()=>{
        if (!(await confirmDialog({message:`Send "${escHtml(btn.dataset.name)}" back for revision?`, html:true}))) return;
        // Payroll recall spec §A3.1 — clear completedAt on send-back (see
        // the aggregated "All Requests" .rt-reject-btn handler above).
        await db.collection('tasks').doc(btn.dataset.id).update({status:'in-progress',sentBackAt:firebase.firestore.FieldValue.serverTimestamp(),completedAt:firebase.firestore.FieldValue.delete(),sentBackBy:currentUser.uid});
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
        const snap2=await db.collection('tasks').doc(btn.dataset.id).get();
        if(snap2.exists){const t2=normTask(snap2.data(),snap2.id);await safeNotify(() => notifyTaskInvolved(t2,{title:'🔁 Task Sent Back',body:`"${btn.dataset.name}" was sent back for revision.`,icon:'🔁',type:'task_status'},currentUser.uid));}
        Notifs.showToast(`"${btn.dataset.name}" sent back for revision.`,'info');
        loadApprovalsSub('review-tasks');
      }));
      return;
    }

    if (sub === 'signups') {
      // Sign-up Requests
      const snap = await db.collection('signup_requests').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
      const items = snap.docs.map(d=>({id:d.id,...d.data()}));
      if (!items.length) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('📋',44)}</div><h4>No signup requests yet</h4></div>`;
        if (window.lucide) lucide.createIcons({ nodes: [wrap] });
        return;
      }
      const pending = items.filter(i=>i.status==='pending');
      wrap.innerHTML = `
        ${pending.length?`<div class="alert-banner alert-warn" style="margin-bottom:12px">${emojiIcon('⚠️',16)} ${pending.length} pending request${pending.length>1?'s':''}</div>`:''}
        <div class="item-list">
          ${items.map(item=>`
          <div class="item-card" data-id="${item.id}">
            <div class="item-top">
              <div class="item-title">${emojiIcon('👤',16)} ${escHtml(item.fullName||'Unknown')}</div>
              <span class="badge ${item.status==='approved'?'badge-green':item.status==='rejected'?'badge-red':'badge-warn'}">${item.status||'pending'}</span>
            </div>
            <div class="item-meta">
              <span>${emojiIcon('✉️',16)} ${escHtml(item.email||'—')}</span>
              <span>${emojiIcon('📱',16)} ${escHtml(item.phone||'—')}</span>
              ${item.createdAt?`<span>${emojiIcon('📅',16)} ${new Date(item.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
            </div>
            ${item.generatedPassword?`<div style="font-size:12px;margin-top:8px;padding:8px 10px;background:rgba(48,209,88,.1);border:1px solid rgba(48,209,88,.3);border-radius:8px;font-family:monospace">${emojiIcon('🔑',16)} Generated Password: <strong>${escHtml(item.generatedPassword)}</strong><br><span style="font-size:10px;color:var(--text-muted)">Create Firebase Auth user with this password</span></div>`:''}
            ${(item.status==='pending'&&canActOn('signup'))?`
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn-success signup-approve" data-id="${item.id}" data-name="${escHtml(item.fullName)}" data-email="${escHtml(item.email)}" data-phone="${escHtml(item.phone||'')}">${emojiIcon('✓',16)} Approve & Generate Password</button>
              <button class="btn-danger signup-reject" data-id="${item.id}" data-name="${escHtml(item.fullName)}">${emojiIcon('✗',16)} Reject</button>
            </div>`:''}
          </div>`).join('')}
        </div>`;
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });

      wrap.querySelectorAll('.signup-approve').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id    = btn.dataset.id;
          const name  = btn.dataset.name;
          const email = btn.dataset.email;
          const phone = btn.dataset.phone;
          const { password: pwd } = await Approvals.dispatch('signup', 'approve', id, { name, email, phone, currentUser });
          openModal(`${emojiIcon('✓',16)} Approved — Action Required`, `
            <p style="margin-bottom:14px;font-size:14px">Profile created for <strong>${escHtml(name)}</strong>.</p>
            <div style="padding:14px;background:rgba(48,209,88,.1);border:1.5px solid rgba(48,209,88,.4);border-radius:10px;margin-bottom:14px">
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Generated Password</div>
              <div style="font-size:22px;font-weight:800;font-family:monospace;letter-spacing:2px;color:var(--text)">${escHtml(pwd)}</div>
            </div>
            <p style="font-size:13px;color:var(--text-muted)">Next steps:</p>
            <ol style="font-size:13px;color:var(--text-muted);line-height:2;padding-left:18px">
              <li>Go to <strong>Firebase Console → Authentication → Add User</strong></li>
              <li>Email: <strong>${escHtml(email)}</strong></li>
              <li>Password: <strong>${escHtml(pwd)}</strong></li>
              <li>Share this password with ${escHtml(name)} via phone or message</li>
              <li>They can change it after first login</li>
            </ol>
          `, `<button class="btn-primary" onclick="closeModal()">Done</button>`);
          Notifs.success(`${name} approved!`);
          loadApprovalsSub('signups');
        });
      });

      wrap.querySelectorAll('.signup-reject').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!(await confirmDialog({message:`Reject ${escHtml(btn.dataset.name)}'s request?`, html:true}))) return;
          await Approvals.dispatch('signup', 'reject', btn.dataset.id, {});
          Notifs.error('Request rejected.');
          loadApprovalsSub('signups');
        });
      });
      return;
    }

    if (sub === 'attendance') {
      // Attendance Extension Requests
      const snap = await db.collection('attendance_extensions').orderBy('requestedAt','desc').get().catch(()=>({docs:[]}));
      const items = snap.docs.map(d=>({id:d.id,...d.data()}));
      const pending = items.filter(i=>i.status==='pending');

      if (!items.length) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⏰',44)}</div><h4>No extension requests</h4></div>`;
        if (window.lucide) lucide.createIcons({ nodes: [wrap] });
        return;
      }
      wrap.innerHTML = `
        ${pending.length?`<div class="alert-banner alert-warn" style="margin-bottom:12px">${emojiIcon('⚠️',16)} ${pending.length} pending request${pending.length>1?'s':''}</div>`:''}
        <div class="item-list">
          ${items.map(item=>`
          <div class="item-card" data-id="${item.id}">
            <div class="item-top">
              <div class="item-title">${emojiIcon('⏰',16)} ${escHtml(item.userName||'Unknown')}</div>
              <span class="badge ${item.status==='approved'?'badge-green':item.status==='denied'?'badge-red':'badge-warn'}">${item.status||'pending'}</span>
            </div>
            <div class="item-meta">
              <span>${emojiIcon('📅',16)} ${item.date||'—'}</span>
              ${item.requestedAt?`<span>Requested: ${new Date(item.requestedAt.toDate()).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</span>`:''}
              ${item.status==='approved'&&item.expiresAt?`<span>Expires: ${new Date(item.expiresAt.toDate()).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</span>`:''}
            </div>
            ${(item.status==='pending'&&canActOn('attendance'))?`
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn-success ext-approve" data-id="${item.id}" data-uid="${item.uid}" data-name="${escHtml(item.userName||'')}">${emojiIcon('✓',16)} Approve (6-hr)</button>
              <button class="btn-danger ext-deny" data-id="${item.id}" data-uid="${item.uid}" data-name="${escHtml(item.userName||'')}">${emojiIcon('✗',16)} Deny</button>
            </div>`:''}
          </div>`).join('')}
        </div>
      `;
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });

      wrap.querySelectorAll('.ext-approve').forEach(btn => {
        btn.addEventListener('click', async e => {
          const { id, uid, name } = e.currentTarget.dataset;
          await window.approveAttendanceExtension(id, uid, name);
          Notifs.success(`Extension approved for ${name}`);
          loadApprovalsSub('attendance');
        });
      });

      wrap.querySelectorAll('.ext-deny').forEach(btn => {
        btn.addEventListener('click', async e => {
          const { id, uid, name } = e.currentTarget.dataset;
          await window.denyAttendanceExtension(id, uid, name);
          Notifs.error(`Extension denied for ${name}`);
          loadApprovalsSub('attendance');
        });
      });
      return;
    }

    if (sub === 'ca') {
      // Cash Advances
      const snap = await db.collection('cash_advances').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
      const items = snap.docs.map(d=>({id:d.id,...d.data()}));
      const pending = items.filter(i=>i.status==='pending');

      if (!items.length) { wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('💸',44)}</div><h4>No cash advance requests</h4></div>`; return; }
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
      wrap.innerHTML = `
        ${pending.length?`<p style="font-size:12px;color:var(--warning);font-weight:600;margin-bottom:12px">${emojiIcon('⚠️',16)} ${pending.length} pending request${pending.length>1?'s':''}</p>`:''}
        <div class="item-list">
          ${items.map(item=>`
          <div class="item-card" data-id="${item.id}">
            <div class="item-top">
              <div class="item-title">${emojiIcon('💸',16)} Cash Advance — ${escHtml(item.userName||'Unknown')}</div>
              ${window.statusBadge2 ? window.statusBadge2('ca', item.status) : `<span class="badge ${statusBadge(item.status)}">${item.status||'pending'}</span>`}
            </div>
            <div class="item-meta">
              <span>₱${fmt(item.amount)}</span>
              <span>Date: ${item.date||'—'}</span>
              <span>Repay: ${item.repayDate||'—'}</span>
            </div>
            ${item.reason?`<div style="font-size:12px;color:var(--text-muted);margin-top:6px;padding:8px 10px;background:var(--surface2);border-radius:6px">${escHtml(item.reason)}</div>`:''}
            ${(item.status==='pending'&&canActOn('ca'))?`
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn-success ca-approve" data-id="${item.id}" data-uid="${item.userId}" data-name="${escHtml(item.userName)}" data-amount="${item.amount}">Approve</button>
              <button class="btn-danger ca-reject" data-id="${item.id}" data-uid="${item.userId}" data-name="${escHtml(item.userName)}">Reject</button>
            </div>`:''}
          </div>`).join('')}
        </div>
      `;
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });

      // v12 WS22 — this was the site with the "balance never set" bug: it flipped
      // status to 'approved' without ever writing a balance, so an advance
      // approved here stayed invisible to every downstream balance filter.
      wrap.querySelectorAll('.ca-approve').forEach(btn => {
        btn.addEventListener('click', e => window.CashAdvance.openApproveModal(e.currentTarget.dataset.id, () => loadApprovalsSub('ca')));
      });
      wrap.querySelectorAll('.ca-reject').forEach(btn => {
        btn.addEventListener('click', async e => {
          try { await window.CashAdvance.reject(e.currentTarget.dataset.id); Notifs.error('Request rejected.'); }
          catch (err) { Notifs.showToast(err.message||'Could not reject.','error'); }
          loadApprovalsSub('ca');
        });
      });

    } else if (sub === 'quote-files') {
      await renderBSQuotationFiles(wrap, currentUser, window.currentRole || 'president');
    } else {
      // Quote / ROA approvals — same shared handlers as the 'all' chip (v12 WS31:
      // the old inline approve/reject here never touched the quote doc at all).
      const snap = await db.collection('approval_requests').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
      const items = snap.docs.map(d => ({id:d.id,...d.data()})).filter(i => i.type !== 'ca_deduct');
      if (!items.length) { wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">✔️</div><h4>No quote approvals</h4></div>`; return; }
      wrap.innerHTML = `<div class="item-list">${items.map(item => `
        <div class="item-card" data-id="${item.id}">
          <div class="item-top">
            <div class="item-title">${item.type==='bs_quote'?'Quote Approval':'Quote'} — ${escHtml(item.clientName||'')}</div>
            <span class="badge ${statusBadge(item.status)}">${item.status||'pending'}</span>
          </div>
          <div class="item-meta">
            <span>${escHtml(item.agentName||'—')}</span>
            <span>₱${fmt(item.total)}</span>
            ${item.quoteNumber?`<span style="font-family:monospace">${escHtml(item.quoteNumber)}</span>`:''}
            ${item.createdAt?`<span>${new Date(item.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
          </div>
          ${(item.status==='pending'&&canActOn('quote-approval')) ? (item.quoteId ? `
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn-primary btn-sm qa-review-btn" data-id="${item.id}" data-quote="${item.quoteId}" data-coll="${item.quoteColl||'bs_quotes'}" data-by="${item.agentId||''}" data-qno="${escHtml(item.quoteNumber||'')}" data-name="${escHtml(item.clientName||'')}">${emojiIcon('📝',16)} Open &amp; Edit</button>
            <button class="btn-success btn-sm qa-approve-btn" data-id="${item.id}" data-quote="${item.quoteId}" data-coll="${item.quoteColl||'bs_quotes'}" data-by="${item.agentId||''}" data-qno="${escHtml(item.quoteNumber||'')}" data-name="${escHtml(item.clientName||'')}">${emojiIcon('✓',16)} Approve</button>
            <button class="btn-danger btn-sm qa-return-btn" data-id="${item.id}" data-quote="${item.quoteId}" data-coll="${item.quoteColl||'bs_quotes'}" data-by="${item.agentId||''}" data-qno="${escHtml(item.quoteNumber||'')}" data-name="${escHtml(item.clientName||'')}">↩ Return to Partner</button>
          </div>` : `
          <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
            <span style="font-size:11px;color:var(--text-muted)">(no linked quote)</span>
            <button class="btn-secondary btn-sm roa-resolve-btn" data-id="${item.id}" data-agent="${item.agentId||''}" data-status="approved">Mark Approved</button>
            <button class="btn-secondary btn-sm roa-resolve-btn" data-id="${item.id}" data-agent="${item.agentId||''}" data-status="rejected">Mark Rejected</button>
          </div>`) : ''}
        </div>`).join('')}</div>`;
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
      wrap.querySelectorAll('.qa-review-btn').forEach(btn => onClickSafe(btn, () =>
        openQuoteApprovalReview({ quoteId:btn.dataset.quote, agentId:btn.dataset.by, quoteNumber:btn.dataset.qno,
          clientName:btn.dataset.name, quoteColl:btn.dataset.coll }, () => loadApprovalsSub('roa'))));
      wrap.querySelectorAll('.qa-approve-btn').forEach(btn => onClickSafe(btn, async () => {
        await approveQuoteApproval(btn.dataset.quote, btn.dataset.by, btn.dataset.qno, btn.dataset.name, btn.dataset.coll);
        loadApprovalsSub('roa');
      }));
      wrap.querySelectorAll('.qa-return-btn').forEach(btn => onClickSafe(btn, async () => {
        const notes = (await promptDialog({message:'Notes for the partner (what to revise)?', multiline:true}))||'';
        await returnQuoteToPartner(btn.dataset.quote, btn.dataset.by, btn.dataset.qno, btn.dataset.name, notes, btn.dataset.coll);
        loadApprovalsSub('roa');
      }));
      wrap.querySelectorAll('.roa-resolve-btn').forEach(btn => onClickSafe(btn, async () => {
        await db.collection('approval_requests').doc(btn.dataset.id).update({ status: btn.dataset.status });
        Notifs.success('Request resolved (no quote doc was linked).'); loadApprovalsSub('roa');
      }));
    }
  };

  // fromChip marks these as user-initiated so a re-tap of the active chip gets
  // the Refreshing… bar; the in-handler refresh calls deliberately don't set it.
  window.bindChipTabs(c, (key) => loadApprovalsSub(key, { fromChip: true }));

  loadApprovalsSub('all');
};

// ── Partner quote-approval helpers (shared by Approvals page) ──────────
// Approve a partner-submitted quote: file it + resolve its approval request + notify.
async function approveQuoteApproval(quoteId, agentId, qno, name, coll){
  coll = coll || 'bs_quotes';
  if(!quoteId){ Notifs.showToast('Quote not found','error'); return; }
  try{
    await db.collection(coll).doc(quoteId).update({
      ...window.quoteStateFields('approved'),
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(), approvedBy: currentUser.uid });
    await db.collection('approval_requests').where('quoteId','==',quoteId).get().then(s=>Promise.all(s.docs.map(d=>d.ref.update({status:'approved'}))));
    if(agentId) await Notifs.send(agentId, { title:'✅ Quote Approved!', body:`Quotation "${qno}" for ${name} was approved and filed.`, icon:'✅', type:'quote_approved', link: coll==='bk_quotes'?'bk-quotations':'bs-quotations' });
    window.logAudit && window.logAudit('update','quote',quoteId,{ approved:true });
    if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('all-quotes'); dbCacheInvalidate('approvals-pending'); }
    if (coll === 'bs_quotes') window.invalidateBsQuotesCache(currentUser.uid);
    Notifs.success('Quote approved and filed!');
  }catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
}
// Return a partner quote for revision: mark needs_revision + notify the partner.
async function returnQuoteToPartner(quoteId, agentId, qno, name, notes, coll){
  coll = coll || 'bs_quotes';
  if(!quoteId){ Notifs.showToast('Quote not found','error'); return; }
  try{
    const upd={ ...window.quoteStateFields('needs_revision'), returnedAt:firebase.firestore.FieldValue.serverTimestamp(), returnedBy:currentUser.uid };
    if(notes) upd.presidentNotes=notes;
    await db.collection(coll).doc(quoteId).update(upd);
    await db.collection('approval_requests').where('quoteId','==',quoteId).get().then(s=>Promise.all(s.docs.map(d=>d.ref.update({status:'returned'}))));
    if(agentId) await Notifs.send(agentId, { title:'↩ Quote Returned for Revision', body:`"${qno}" for ${name} was reviewed and returned.${notes?' Notes: '+notes:''} Please revise and re-submit.`, icon:'✎', type:'quote_returned', link: coll==='bk_quotes'?'bk-quotations':'bs-quotations' });
    window.logAudit && window.logAudit('update','quote',quoteId,{ returned:true });
    if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('all-quotes'); dbCacheInvalidate('approvals-pending'); }
    if (coll === 'bs_quotes') window.invalidateBsQuotesCache(currentUser.uid);
    Notifs.error('Quote returned to partner.');
  }catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
}
// Open the full review modal: open in builder, edit key fields, then approve/return.
//
// v14.0.71 drill-down smoothness pass — INVERTED. This used to await the quote
// doc and only THEN call openPage, so tapping "Open & Edit" moved zero pixels
// until the Firestore round-trip landed: the press state had already released
// and there was nothing in the DOM to animate. The panel is now pushed
// synchronously, in the tap's own frame, holding a skeleton, and the quote fills
// it in when it arrives. WHAT is rendered is unchanged — only WHEN.
//
// Three things the inversion has to pay for, each costing a few lines below:
//
//  • THE EXISTENCE CHECK CANNOT MOVE. `snap.exists` used to gate the open, and
//    it cannot run before a window that is opened in the tap's frame — it IS the
//    fetch. The rule it enforced still holds though (never let the user act on a
//    record that turns out not to exist), so it is enforced on the ACTIONS
//    instead of on the window: #qar-approve / #qar-return ship DISABLED and are
//    only enabled once a real quote doc has actually been read. On the
//    missing/unreadable path the footer collapses to Cancel and the body says
//    why, so nothing is ever yanked out from under a tap and nothing is
//    actionable. The synchronous `!quoteId` guard above still runs BEFORE the
//    open — it needs no fetch, and a review panel for a request carrying no
//    quote id at all would have nothing to review.
//
//  • CLOSED MID-FLIGHT. The user can hit Back before the read lands. Every fill
//    is guarded on `p.isConnected`, so a torn-down panel is left alone: no
//    innerHTML write that would resurrect it, no listener wiring against a dead
//    node, no onDone.
//
//  • LISTENERS WIRE AFTER THE FILL. The body markup does not exist at openPage
//    time any more, so #qar-open-builder and the #qar-* field reads are bound
//    (and queried) only once the markup is in, scoped to this panel rather than
//    via document.getElementById — with a stacked/`.page-under` panel in the DOM
//    a document-wide id lookup can resolve to the wrong window's field.
async function openQuoteApprovalReview(ctx, onDone){
  const { quoteId, agentId, quoteNumber, clientName } = ctx;
  const QC = ctx.quoteColl || 'bs_quotes';
  if(!quoteId){ Notifs.showToast('Quote not found','error'); return; }
  const ta = 'width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical';
  // 'rows' is the closest of skeletonHtml's three kinds to this body's anatomy
  // (a stack of full-width blocks: the builder button + four form groups); 5 to
  // match that count, so the panel does not visibly change height on fill.
  const p = openPage(`${emojiIcon('📝',16)} Review Quote — ${escHtml(quoteNumber||'')}`,
    window.skeletonHtml('rows', 5),
    `<button class="btn-success" id="qar-approve" disabled>${emojiIcon('✅',16)} Save &amp; Approve</button><button class="btn-primary" id="qar-return" disabled>↩ Save &amp; Return to Partner</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  const body = p.querySelector('.page-panel-body');
  const foot = p.querySelector('.page-panel-foot');

  let snap = null, readErr = null;
  try { snap = await db.collection(QC).doc(quoteId).get(); }
  catch (ex) { readErr = ex; }
  // Back was pressed while the read was in flight — the panel is gone. Touch
  // nothing (see the close-mid-flight note in the header comment).
  if (!p.isConnected) return;

  if (!snap || !snap.exists || readErr) {
    // Same toast the pre-inversion code fired on this path, kept so the failure
    // signal is byte-identical to what users already know — plus an in-panel
    // state, because a window that is already open must never be left sitting on
    // an eternal skeleton. Footer drops to Cancel: with no quote read, approve
    // and return have nothing to write to and stay unreachable.
    Notifs.showToast('Quote not found','error');
    // The raw Firestore error goes to the console ONLY — same convention as the
    // per-collection `console.error('<x> query failed', e)` catches in
    // loadApprovalsSub. Its text ("Missing or insufficient permissions.",
    // "The caller does not have permission…") names backend rules and means
    // nothing to a President or Secretary, so the panel gets a human sentence
    // instead and the string stays available for diagnosis.
    if (readErr) console.error('quote review read failed', QC, quoteId, readErr);
    body.innerHTML = window.renderEmptyState({
      icon: '⚠️',
      title: 'Quote not found',
      hint: readErr ? 'This quote could not be loaded right now. Close and try again — if it keeps failing, report it to IT.'
                    : 'This quote could not be loaded — it may have been deleted or already actioned.'
    });
    foot.innerHTML = `<button class="btn-secondary" onclick="closeModal()">Cancel</button>`;
    window.lucide?.createIcons({ nodes: [body] });
    return;
  }

  const q = snap.data();
  const hasSnapshot = !!q.editableState;
  body.innerHTML = `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Open the full quote in the builder to review/edit line items (saved back to the partner's quote), or adjust the key fields below, then approve or return it to the partner.</p>
    <button class="btn-secondary btn-sm" id="qar-open-builder" style="margin-bottom:14px" ${hasSnapshot?'':'disabled title="No editable snapshot for this quote"'}>${emojiIcon('🔧',16)} Open full quote in Builder${hasSnapshot?'':' (no snapshot)'}</button>
    <div class="form-group"><label>Client Name</label><input id="qar-client" value="${(q.clientName||'').replace(/"/g,'&quot;')}"/></div>
    <div class="form-group"><label>Scope / Description</label><textarea id="qar-scope" rows="3" style="${ta}">${escHtml(q.scope||q.description||'')}</textarea></div>
    <div class="form-group"><label>Adjusted Total (₱)</label><input id="qar-total" type="number" value="${q.total||q.grandTotal||0}" inputmode="decimal"/></div>
    <div class="form-group"><label>Notes for Partner</label><textarea id="qar-notes" rows="2" placeholder="What to revise, or why approved…" style="${ta}">${escHtml(q.presidentNotes||'')}</textarea></div>
  `;
  // openPage's own sweep already ran (on the frame it pushed the panel) and
  // covered the footer; this markup arrived after it, so its icons — the 🔧 on
  // the builder button — need their own pass or they render as blank gaps.
  window.lucide?.createIcons({ nodes: [body] });

  // The title carried a fetched fallback: `quoteNumber || q.quoteNumber`. Only
  // the ctx half was available at open time, so patch the rare case where the
  // approval_requests doc had no quoteNumber and the quote doc does. app.js's
  // _setPanelTitle is module-private, so its two strip-and-collapse steps are
  // repeated here; only the TEXT node is rewritten, leaving the icon element
  // that helper prepended in place.
  if (!quoteNumber && q.quoteNumber) {
    const tEl = p.querySelector('.page-panel-title');
    const tTxt = tEl && Array.prototype.find.call(tEl.childNodes, n => n.nodeType === 3);
    if (tTxt) tTxt.textContent = `${emojiIcon('📝',16)} Review Quote — ${escHtml(q.quoteNumber)}`
      .replace(/<i\s+data-lucide="([a-z0-9-]+)"[^>]*>\s*<\/i>/gi, ' ')
      .replace(/<span class="emoji-icon">([^<]*)<\/span>/gi, '$1')
      .replace(/\s+/g, ' ').trim();
  }

  if (hasSnapshot) body.querySelector('#qar-open-builder').addEventListener('click', ()=>{
    window._qbReviewContext = { quoteId, partnerUid: agentId, quoteNumber: quoteNumber||q.quoteNumber,
      clientName: q.clientName||clientName, quoteColl: QC };
    closeModal();
    window.reopenQuoteFromDoc(QC, quoteId, window.quoteBuilderPageFor(q.company));
  });
  const getEdits = ()=>({ clientName:body.querySelector('#qar-client').value.trim(), scope:body.querySelector('#qar-scope').value.trim(), total:parseFloat(body.querySelector('#qar-total').value)||q.total||0, presidentNotes:body.querySelector('#qar-notes').value.trim(), editedByPresident:true, editedAt:firebase.firestore.FieldValue.serverTimestamp(), editedBy:currentUser.uid });
  // A quote doc is in hand, so the two writing actions become live. Removing the
  // attribute (rather than re-rendering the footer) keeps the final markup
  // byte-identical to the pre-inversion footer.
  const approveBtn = foot.querySelector('#qar-approve');
  const returnBtn  = foot.querySelector('#qar-return');
  approveBtn.removeAttribute('disabled');
  returnBtn.removeAttribute('disabled');
  approveBtn.addEventListener('click', async ()=>{
    const e=getEdits();
    try{
      await db.collection(QC).doc(quoteId).update({ ...e, ...window.quoteStateFields('approved'), approvedAt:firebase.firestore.FieldValue.serverTimestamp(), approvedBy:currentUser.uid });
      await db.collection('approval_requests').where('quoteId','==',quoteId).get().then(s=>Promise.all(s.docs.map(d=>d.ref.update({status:'approved'}))));
      if(agentId) await Notifs.send(agentId, { title:'✅ Quote Approved!', body:`Quotation "${quoteNumber}" for ${e.clientName||clientName} was approved and filed.`, icon:'✅', type:'quote_approved', link: QC==='bk_quotes'?'bk-quotations':'bs-quotations' });
      window.logAudit && window.logAudit('update','quote',quoteId,{ approved:true, edited:true });
      if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('all-quotes'); dbCacheInvalidate('approvals-pending'); }
      if (QC === 'bs_quotes') window.invalidateBsQuotesCache(currentUser.uid);
      closeModal(); Notifs.success('Quote edited, approved and filed!'); onDone&&onDone();
    }catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
  });
  returnBtn.addEventListener('click', async ()=>{
    const e=getEdits();
    try{
      await db.collection(QC).doc(quoteId).update({ ...e, ...window.quoteStateFields('needs_revision'), returnedAt:firebase.firestore.FieldValue.serverTimestamp(), returnedBy:currentUser.uid });
      await db.collection('approval_requests').where('quoteId','==',quoteId).get().then(s=>Promise.all(s.docs.map(d=>d.ref.update({status:'returned'}))));
      if(agentId) await Notifs.send(agentId, { title:'↩ Quote Returned for Revision', body:`"${quoteNumber}" for ${e.clientName||clientName} was reviewed and returned.${e.presidentNotes?' Notes: '+e.presidentNotes:''}`, icon:'✎', type:'quote_returned', link: QC==='bk_quotes'?'bk-quotations':'bs-quotations' });
      window.logAudit && window.logAudit('update','quote',quoteId,{ returned:true, edited:true });
      if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('all-quotes'); dbCacheInvalidate('approvals-pending'); }
      if (QC === 'bs_quotes') window.invalidateBsQuotesCache(currentUser.uid);
      closeModal(); Notifs.error('Quote updated and returned to partner.'); onDone&&onDone();
    }catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
  });
}
