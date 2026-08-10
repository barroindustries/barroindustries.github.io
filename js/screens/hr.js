/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — HR + Payroll screens
   js/screens/hr.js

   Wave 7 Pass 3 — split out of js/departments.js verbatim, 2026-08-03,
   following the Wave 2 (design.js) / Wave 7 Pass 1-2 (tasks.js/sales.js)
   extraction protocol. Still plain `window.*`-attached globals, no ESM, no
   bundler — this file is a physical split only, not a module.

   Contents: the Salary Raise UI (openSalaryRaiseModal/openRaiseHistory/
   window.openScheduledRaises — the RaiseFlow lifecycle SERVICE they call
   stays in departments.js, see below), the HR hub card launcher
   (window.renderHR), the payroll reconciliation screen (buildThreeWayRecon/
   threeWayReconTableHTML/openPayrollReconciliation), the Payroll hub
   (window.renderPayrollHub — the Office Team / Operations Team chip-tab wrapper (the
   payClass values stay 'regular'/'production'; only the LABELS were renamed) that is now
   the single entry point for BOTH payroll screens; see its own header block),
   Payroll Management
   (renderPayrollManagement, incl. its nested loadPayrollTable/
   loadPayRunStrip and Payroll History table), and the HR Profiles +
   Worker Payslip suite (nextWorkerIdNumber/syncWorkerDirectory/
   ensureWorkerVerifyToken/openWorkerIDModal/batchPrintWorkerIDs/
   renderFinanceHRProfiles/openHRProfileForm/openWorkerKioskModal/
   PAYSLIP_STAGES/payslipStageBadge/openPayslipHistory/openPayslipEdit/
   openPayslipGenerator/computeDayHours/psFormInputs/psTotals/
   collectPayslipData/
   window.toPayslipModel/window.thirteenthMonthFor/window.payslipYtdMonthly/
   window.payslipYtdWeekly/window.buildPayslipHTML/window.renderPayslipPage/
   window.downloadPayslipJPEG).

   Wave 7 Pass 3 conversion (spec point 2) — window.renderPayslipPage was a
   raw #page-content swap that predated the page-stack (openPage/Overlay).
   It is now a real openPage panel: Print/Save-as-JPEG/Transfer-Proof move
   into opts.headerRightHTML (openPage's own back arrow replaces the old
   hand-rolled "← Back" button — one header, not two), and the `backFn`
   argument is wired as opts.onClose so it still fires exactly once, on
   teardown, regardless of how the panel closes (Back button, another
   openPage stacking with {replace:true}, or Overlay.clearAll()). Because
   the payslip now genuinely stacks instead of destroying whatever was under
   it, js/app.js's worker-profile Payslip button (openWorkerProfilePanel,
   #wp-payslip-btn) no longer strictly needs its `window.Overlay.dismissTop()`
   pre-step — that caller is untouched here (out of scope: app.js is
   read-only for this pass) but is a natural follow-up cleanup; see the pass
   report.

   DELIBERATELY LEFT IN departments.js (grepped for outside callers before
   this move; the HARD boundary per the Wave 7 spec — money-moving SERVICES
   stay, screens move):
     - window.computePayRun / window.disbursePayRun / window.reopenPayRun —
       the One Payroll Engine (Compute → Verify → Disburse) itself. This
       file's renderPayrollManagement still calls all three as window.*
       globals at runtime (button handlers), same forward/cross-file
       reference pattern tasks.js/sales.js already document.
     - window.RaiseFlow (submitRaise/materialize/applyDueRaises/approve/
       reject) — the raise lifecycle SERVICE (schedule → approve →
       materialize into payroll/{uid} or worker_profiles + the immutable
       salary_raises audit log). Left behind because departments.js's
       renderApprovals (itself staying, per the Pass 1 precedent) calls
       RaiseFlow.approve/reject directly for raise-approval requests — the
       same "too entangled to extract cleanly" call the Pass 1 report made
       for Approvals itself. This file's openSalaryRaiseModal/
       renderPayrollManagement/renderFinanceHRProfiles call window.RaiseFlow
       as a plain global at runtime; no behavior change.
     - CashAdvance / Ledger / BankAccounts / financeDelete /
       financeExecuteDelete / assertPeriodOpen — shared money services used
       (not owned) by the payroll/payslip screens here, exactly like
       sales.js's relationship to openSalesOrderModal.
     - isFinancePriv / isRealPresident / canEditDept / deptContainer /
       fetchUsersWithPayroll / computeStatutory / ROLES — generic app-wide
       helpers untouched by this split.
     - window.printIDCards / window.buildIdVerifyDoc / window.buildQRSVG /
       window.makeTrackCode — app.js/drive.js/config.js helpers this file's
       Worker ID screens call by window.* name; per the task brief, app.js
       is not touched by this pass.

   LOAD-ORDER CONTRACT (see index.html + CLAUDE.md "Script load order
   is load-bearing"):
     - Loads AFTER js/departments.js and js/screens/design.js/tasks.js/
       sales.js. Every function in this file is invoked only at runtime
       (click handlers, navigateTo() dispatch, promise callbacks) — never at
       parse time — so it is safe for departments.js's shared helpers to
       still be undefined at the moment THIS file's top-level code runs,
       and equally safe for departments.js's renderApprovals/
       renderPayrollManagement-callers (loadFinanceContent's switch, which
       loads BEFORE this file but only calls into it later, at runtime) to
       reference this file's globals.
     - window.renderHR is the entry point called from js/app.js's
       navigateTo() switch (case 'HR'). window.renderPayslipPage /
       window.toPayslipModel / window.payslipYtdMonthly are also called
       directly from js/app.js (personal-finance "my-payslip-btn" and the
       worker-profile panel's #wp-payslip-btn — see the conversion note
       above). departments.js's loadFinanceContent calls
       renderPayrollManagement / renderFinanceHRProfiles as bare global
       identifiers (both are plain `function` declarations, not
       window.*-prefixed, exactly like tasks.js/sales.js's bare-identifier
       precedent — a top-level function declaration in any deferred
       classic script becomes a `window` property, so the bare-identifier
       call in departments.js resolves fine regardless of which file
       actually declares it).
     - PAYSLIP_STAGES is a plain top-level `const` (script-scoped, NOT a
       window property in a browser — same caveat design.js/tasks.js
       document for their own top-level consts). It must stay in THIS file
       alongside payslipStageBadge/openPayslipHistory/openPayslipEdit,
       which are the only readers.
   ═══════════════════════════════════════════════════ */

// ── Shared failure block for this file's window-first drill-downs ──────────
// (v14.0.71 responsiveness pass.) Every drill-down below now pushes its
// openPage panel SYNCHRONOUSLY in the tap handler with a skeleton body and
// fills it once the read lands. Two shapes are used, deliberately:
//
//   • window.withLoadingAndError (js/ui-states.js) wherever the fill is a
//     single innerHTML assignment — it already owns skeleton → await → render
//     → error-with-Retry, so there is nothing to hand-roll.
//   • THIS helper wherever the fill is followed by a block of existing
//     listener/save code. Wrapping ~70-100 lines of payroll/gov-ID handler
//     code in withLoadingAndError's renderer callback would re-indent all of
//     it for zero behavioural gain (and several of those blocks contain
//     multi-line template literals whose inner indentation is HTML *content*),
//     so those panels hand-roll the same lifecycle and share this block.
//
// The markup is deliberately identical to withLoadingAndError's own error
// state, so a failed drill-down looks the same no matter which path produced
// it. `retry` is optional — when omitted the button is left out entirely
// rather than rendered dead.
function _hrPanelError(container, err, retry) {
  if (!container) return;
  const msg = (err && err.message) ? err.message : String(err);
  container.innerHTML =
    '<div class="empty-state">' +
      '<div class="empty-icon">' + (window.emojiIcon ? window.emojiIcon('\u26a0\ufe0f', 44) : '') + '</div>' +
      '<h4>Something went wrong</h4>' +
      '<p>' + escHtml(msg) + '</p>' +
      (retry ? '<button type="button" class="btn-secondary btn-sm uistate-retry-btn" style="margin-top:14px">Retry</button>' : '') +
    '</div>';
  if (retry) container.querySelector('.uistate-retry-btn')?.addEventListener('click', retry);
  // Same guarded sweep withLoadingAndError uses: emojiIcon() emits
  // `<i data-lucide>`, and openPage's own sweep already ran while the body was
  // still a skeleton, so the warning glyph would otherwise stay a blank gap.
  if (window.lucide && container.querySelector('[data-lucide]:not(svg)')) lucide.createIcons({ nodes: [container] });
}

// ── Salary Raise (shared by Payroll + HR Profiles) ─
// Applies a raise immediately and logs it to salary_raises (old→new, %, effective
// date, reason, who granted it). Finance/admin only; an affected app-user can read
// their own raise records (firestore.rules mirrors the salary_history gate).
function openSalaryRaiseModal({ subjectType, subjectId, subjectName, fieldLabel, targetField, current }, currentUser, onDone) {
  const cur = parseFloat(current) || 0;
  const _isPres = typeof isRealPresident === 'function' && isRealPresident();
  const _panel = openPage(`${emojiIcon('💸',16)} Give Raise — ${escHtml(subjectName||'')}`, `
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
      Current ${escHtml(fieldLabel)}: <strong style="color:var(--text)">₱${fmt(cur)}</strong>
    </div>
    <div class="form-row">
      <div class="form-group"><label>New ${escHtml(fieldLabel)} (₱) *</label>
        <input id="raise-new" type="number" inputmode="decimal" step="0.01" min="0" value="${cur}"/></div>
      <div class="form-group"><label>Quick increase</label>
        <div style="display:flex;gap:6px">
          <input id="raise-amt" type="number" inputmode="decimal" placeholder="+ ₱" style="flex:1;min-width:0"/>
          <input id="raise-pct" type="number" inputmode="decimal" placeholder="+ %" style="width:64px"/>
        </div>
      </div>
    </div>
    <div id="raise-preview" style="font-size:13px;font-weight:700;margin:-2px 0 12px;min-height:18px"></div>
    <div class="form-row">
      <div class="form-group"><label>Effective Date</label><input id="raise-eff" type="date" value="${today()}"/></div>
      <div class="form-group"><label>Reason / Notes</label><input id="raise-reason" placeholder="e.g. Annual increase, promotion"/></div>
    </div>
    ${!_isPres?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Raises are approval-routed — this will be sent to the President.</div>`:''}
  `, `<button class="btn-primary" id="raise-save-btn">${_isPres?'Apply Raise':'Request Raise'}</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  // ⚠ SCOPED TO THIS PANEL, NOT document.
  // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second
  // record inside that window and two panels carry the same element ids at
  // once — document.getElementById() returns the FIRST match in document
  // order, which is the DYING panel. At bind time the handler lands on a
  // button nobody can see (the visible one gets none); inside the handler
  // the field reads pull the PREVIOUS record's values and write them onto
  // THIS record. Corporate Secretary report, reproduced 2026-08-10.
  const $rz = (id) => _panel.querySelector('#' + id);

  const newInp = $rz('raise-new');
  const amtInp = $rz('raise-amt');
  const pctInp = $rz('raise-pct');
  const prev   = $rz('raise-preview');
  // Button text is date/role aware (v12 WS23): a future-dated raise SCHEDULES
  // rather than applies, even for the President.
  const _btnLabel = () => {
    const effM = ($rz('raise-eff')?.value || today()).slice(0,7);
    if (!_isPres) return 'Request Raise';
    return effM <= today().slice(0,7) ? 'Apply Raise' : 'Schedule Raise';
  };
  const refresh = () => {
    const nv = parseFloat(newInp.value) || 0;
    const diff = nv - cur;
    const pct = cur > 0 ? (diff / cur * 100) : null;
    if (!diff) { prev.textContent = ''; return; }
    prev.style.color = diff > 0 ? 'var(--success)' : 'var(--danger)';
    prev.textContent = `${diff > 0 ? '▲ +' : '▼ '}₱${fmt(Math.abs(diff))}${pct!=null?`  (${pct>=0?'+':''}${pct.toFixed(1)}%)`:''}`;
  };
  amtInp.addEventListener('input', () => { if (amtInp.value !== '') { newInp.value = (cur + (parseFloat(amtInp.value)||0)).toFixed(2); pctInp.value = ''; } refresh(); });
  pctInp.addEventListener('input', () => { if (pctInp.value !== '') { newInp.value = (cur * (1 + (parseFloat(pctInp.value)||0)/100)).toFixed(2); amtInp.value = ''; } refresh(); });
  newInp.addEventListener('input', () => { amtInp.value = ''; pctInp.value = ''; refresh(); });
  $rz('raise-eff').addEventListener('change', () => {
    const b = $rz('raise-save-btn'); if (b) b.textContent = _btnLabel();
  });

  $rz('raise-save-btn').addEventListener('click', async () => {
    const nv = parseFloat(newInp.value) || 0;
    if (nv <= 0)    { Notifs.showToast('Enter a valid new amount','error'); return; }
    if (nv === cur) { Notifs.showToast('New amount is unchanged','error'); return; }
    const reason = $rz('raise-reason').value.trim();
    const eff    = $rz('raise-eff').value || today();
    const btn = $rz('raise-save-btn');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const res = await window.RaiseFlow.submitRaise(
        { subjectType, subjectId, subjectName, fieldLabel, targetField, current: cur },
        { newAmount: nv, effectiveDate: eff, reason }
      );
      closeModal();
      if (res.outcome === 'requested')
        Notifs.success('Raise sent to the President for approval.');
      else
        Notifs.success(`Raise ${eff.slice(0,7) <= today().slice(0,7) ? 'applied' : 'scheduled'}: ₱${fmt(cur)} → ₱${fmt(nv)}`);
      onDone && onDone();
    } catch (e) {
      console.error('raise failed', e);
      btn.disabled = false; btn.textContent = _isPres ? 'Apply Raise' : 'Request Raise';
      Notifs.showToast('Failed to submit raise','error');
    }
  });
}

// Read-only log of past raises (finance/admin). Optionally filter to one subject.
async function openRaiseHistory(opts = {}) {
  // ── WINDOW FIRST, DATA SECOND (v14.0.71) ────────────────────────────────
  // This used to await the 200-doc salary_raises read and call openPage only
  // once it landed, so between finger-up and the response not one pixel
  // changed — the press state had already released and there was nothing in
  // the DOM to animate. The panel is now pushed synchronously in the tap
  // handler with a skeleton body and filled afterwards.
  //
  // Title and footer are derived from `opts` ONLY, never from the fetched
  // rows, so both are final at open time and never need a second pass. The
  // footer's only control is inline onclick="closeModal()", which is live from
  // the moment the panel exists — so there is nothing to re-wire after the
  // fill, which is why this one uses withLoadingAndError rather than the
  // hand-rolled shape.
  const panel = openPage(
    `${emojiIcon('💸',16)} Salary Raise History${opts.subjectName?` — ${escHtml(opts.subjectName)}`:''}`,
    window.skeletonHtml('table'),
    `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
  const bodyEl = panel.querySelector('.page-panel-body');

  await window.withLoadingAndError(bodyEl, async () => {
    // PER-PERSON: query BY SUBJECT rather than reading the newest 200 rows
    // company-wide and filtering in JS. The old shape silently showed
    // "No salary raises recorded yet" for anyone whose raises fell outside
    // those 200 — a cap that only becomes visible once per-person history is
    // reachable from a profile screen, which it now is.
    //
    // `subjectId` is TWO id spaces: an auth uid for subjectType 'payroll' and a
    // worker_profiles docId for 'worker_profile'. Callers may therefore pass
    // subjectIds:[uid, workerProfileId] to cover a person who exists in both.
    //
    // Equality-only + a client-side sort, deliberately: adding .orderBy() here
    // would need a (subjectId, createdAt) composite index that does not exist,
    // and a missing index throws FAILED_PRECONDITION — which the ambient catch
    // would render as an empty history rather than an error. 'in' over <= 10
    // values stays a single-field query, so it needs no index either.
    const subjectIds = (Array.isArray(opts.subjectIds) && opts.subjectIds.length
      ? opts.subjectIds
      : (opts.subjectId ? [opts.subjectId] : [])).filter(Boolean).slice(0, 10);
    const snap = subjectIds.length
      ? await db.collection('salary_raises').where('subjectId','in',subjectIds).limit(200).get().catch(()=>({docs:[]}))
      : await db.collection('salary_raises').orderBy('createdAt','desc').limit(200).get().catch(()=>({docs:[]}));
    let list = snap.docs.map(d=>({id:d.id,...d.data()}));
    if (subjectIds.length) list.sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
    return list;
  }, (list) => {
    // CLOSED MID-FLIGHT: Back can be pressed before the read lands. openPage's
    // teardown detaches the panel, so `bodyEl` would by then be an orphan node
    // — writing to it throws nothing and shows nothing, but bailing makes it
    // explicit that this path can never touch (or resurrect) a dismissed
    // window.
    if (!panel.isConnected) return;
    // NOTE ON INDENTATION: the `rows` builder below is byte-for-byte what it
    // was before this pass, including its 2-space statement indent. Its inner
    // lines are inside a template literal, i.e. they are HTML *content* — so
    // re-indenting the block to match its new nesting level would change the
    // markup this screen emits. Left exactly as it was on purpose.
  const rows = !list.length
    ? `<div class="empty-state" style="padding:30px"><div class="empty-icon">${emojiIcon('💸',44)}</div><p>No salary raises recorded yet.</p></div>`
    : `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Effective</th><th>Employee</th><th>Type</th><th>Old → New</th><th>Change</th><th>Reason</th><th>By</th></tr></thead>
        <tbody>${list.map(r=>{
          const up = (r.changeAmount||0) >= 0;
          return `<tr>
            <td style="white-space:nowrap;font-size:12px">${escHtml(r.effectiveDate||'—')}</td>
            <td style="font-weight:600">${escHtml(r.subjectName||'—')}</td>
            <td><span class="badge ${r.subjectType==='payroll'?'badge-blue':'badge-purple'}">${r.subjectType==='payroll'?'Payroll':'Worker'}</span></td>
            <td style="white-space:nowrap">₱${fmt(r.oldAmount||0)} → <strong>₱${fmt(r.newAmount||0)}</strong></td>
            <td style="white-space:nowrap;color:${up?'var(--success)':'var(--danger)'};font-weight:700">${up?'+':''}₱${fmt(r.changeAmount||0)}${r.changePct!=null?` (${r.changePct>=0?'+':''}${r.changePct}%)`:''}</td>
            <td style="font-size:12px">${escHtml(r.reason||'—')}</td>
            <td style="font-size:12px;color:var(--text-muted)">${escHtml(r.grantedByName||'—')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    bodyEl.innerHTML = rows;
  }, { skeleton: 'table' });
}

// Admin list of scheduled + pending-approval raises (the SCHEDULE half of the
// lifecycle — openRaiseHistory above stays the immutable APPLIED log).
window.openScheduledRaises = async function() {
  // ── WINDOW FIRST, DATA SECOND (v14.0.71) ────────────────────────────────
  // The pending_raises read used to run BEFORE openPage, so the tap produced
  // no visible change at all until it landed. The panel is now pushed
  // synchronously with a skeleton body and filled in place.
  //
  // {replace:true} stays on the one and only openPage call, exactly where it
  // was, so the page-stack depth is unchanged: approve/reject re-invoke this
  // WHOLE function, and that second invocation's openPage swaps the first
  // one's panel in place (openPage falls back to a normal push when there is
  // no page on top — the first-open case). The old `render()` indirection is
  // gone because it was only ever called once per invocation.
  const isPres = typeof isRealPresident === 'function' && isRealPresident();
  const panel = openPage(`${emojiIcon('💸',16)} Scheduled &amp; Pending Raises`, window.skeletonHtml('table'),
    `<button class="btn-secondary" onclick="closeModal()">Close</button>`, {replace:true});
  const bodyEl = panel.querySelector('.page-panel-body');

  await window.withLoadingAndError(bodyEl, async () => {
    const snap = await db.collection('pending_raises').where('status','in',['scheduled','pending_approval']).get().catch(()=>({docs:[]}));
    return snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.effectiveDate||'').localeCompare(b.effectiveDate||''));
  }, (list) => {
    // Closed mid-flight — never write into (or re-animate) a dismissed window.
    if (!panel.isConnected) return;
    const rows = !list.length
      ? `<div class="empty-state" style="padding:30px"><div class="empty-icon">${emojiIcon('💸',44)}</div><p>No scheduled or pending raises.</p></div>`
      : `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Effective</th><th>Employee</th><th>Old → New</th><th>Status</th><th>By</th><th></th></tr></thead>
          <tbody>${list.map(r=>`<tr data-id="${r.id}">
            <td style="white-space:nowrap;font-size:12px">${escHtml(r.effectiveDate||'—')}</td>
            <td style="font-weight:600">${escHtml(r.subjectName||'—')}</td>
            <td style="white-space:nowrap">₱${fmt(r.oldAmount||0)} → <strong>₱${fmt(r.newAmount||0)}</strong></td>
            <td><span class="badge ${r.status==='scheduled'?'badge-blue':'badge-orange'}">${r.status==='scheduled'?'Scheduled':'Pending Approval'}</span></td>
            <td style="font-size:12px;color:var(--text-muted)">${escHtml(r.requestedByName||'—')}</td>
            <td style="white-space:nowrap">
              ${(r.status==='pending_approval'&&isPres)?`<button class="btn-success btn-sm sr-approve-btn" data-id="${r.id}">${emojiIcon('✓',16)} Approve</button> <button class="btn-danger btn-sm sr-reject-btn" data-id="${r.id}">${emojiIcon('✗',16)} Reject</button>`:''}
            </td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    bodyEl.innerHTML = rows;
    // ── LISTENERS AFTER THE FILL ──────────────────────────────────────────
    // These used to sit on the line right after openPage, when the body
    // already held the real rows. Post-inversion the buttons do not exist
    // until the assignment one line up, so wiring any earlier would silently
    // bind nothing and Approve/Reject would be dead controls.
    panel.querySelectorAll('.sr-approve-btn').forEach(btn=>btn.addEventListener('click', async ()=>{
      const r = await window.RaiseFlow.approve(btn.dataset.id);
      Notifs.showToast(r==='approved'?'Raise approved.':'Already resolved.');
      window.openScheduledRaises();
    }));
    panel.querySelectorAll('.sr-reject-btn').forEach(btn=>btn.addEventListener('click', async ()=>{
      const reason = (await promptDialog({message:'Reason for declining (optional):', multiline:true}))||'';
      await window.RaiseFlow.reject(btn.dataset.id, reason);
      Notifs.error('Raise declined.');
      window.openScheduledRaises();
    }));
  }, { skeleton: 'table' });
};

// ── Payroll Management ───────────────────────────
// ── HR department hub ──────────────────────────────────────────────────
// Brings the people-side of the company into one place: role/department
// assignment, the monthly payroll run, weekly worker payslips, leave, and
// attendance. Each card opens the existing screen (no duplicated logic).
// Sensitive — management & finance only.
window.renderHR = async function(currentUser, currentRole){
  const c = deptContainer();
  const role = window.currentRole || currentRole || '';
  if (!['president','manager','secretary','finance'].includes(role)) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🔒',44)}</div><h4>HR is management &amp; finance only</h4></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    return;
  }
  const canAccounts = ['president','manager'].includes(role);   // renderTeam gate parity
  // 2026-08-09 — HR stays OPEN to the Corporate Secretary (People & Roles,
  // attendance, leave, ID cards, holidays, work sites: owner ruling 2), but
  // Payroll does NOT: firestore.rules now denies them payroll/payslips/pay_runs/
  // worker_profiles reads outright, so this card would open a screen whose every
  // query is denied and — because they all end in `.catch(()=>({docs:[]}))` —
  // silently renders as an empty payroll rather than as an error.
  const canPayroll = (typeof window.isMoneyPriv === 'function') ? window.isMoneyPriv() : true;
  const cards = [
    // Owner request 2026-08-09 — "employee profiles on hr … official employment
    // date, sss number etc, their status like training, employed, or what, what
    // their job is". ONE roster covering BOTH teams; each row opens the same
    // profile screen (js/screens/employee-profile.js).
    { icon:'🪪', title:'Employee Profiles', desc:'Employment date, status, job, IDs · rates, cash advance, raises & payroll history', go:()=>window.renderEmployeeProfiles && window.renderEmployeeProfiles() },
    { icon:'👥', title:'People & Roles', desc:'Assign roles, departments & employee class', go:()=>navigateTo('team-directory') },
    // One card, two tabs (owner: "Better if its just / Payroll / Then / Type a
    // / Type b"). Opens the hub, which lands on Type A by default.
    ...(canPayroll ? [{ icon:'💰', title:'Payroll',        desc:'Office Team monthly run (Compute → Verify → Disburse) + Operations Team weekly payslips', go:()=>window.renderFinance(currentUser, currentRole, 'Payroll') }] : []),
    ...(canAccounts ? [{ icon:'🔑', title:'Accounts & Logins', desc:'Create worker logins, reset passwords, edit pay', go:()=>navigateTo('team') }] : []),
    { icon:'📍', title:'Work Sites',     desc:'Geofenced Time In/Out locations for Type-B (Production) self-service', go:()=>openWorkSitesPage(currentUser, currentRole) },
    { icon:'🌴', title:'Leave',          desc:'Requests, approvals & balances',             go:()=>window.renderLeavePage && window.renderLeavePage() },
    { icon:'🕐', title:'Attendance',     desc:'Daily attendance & time-extension requests', go:()=>navigateTo('attendance') },
  ];
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('👥',20)} Human Resources</h2></div>
    ${window.sopPanel('How HR works', [
      'People & Roles — set each person’s role, department(s) and employee class (Regular monthly vs Production weekly).',
      'Payroll → Office Team — the monthly cycle for regular staff: Compute the figures, Verify them, then mark Disbursed once salaries are released (finalize by the 5th).',
      'Payroll → Operations Team — generate weekly payslips for Production workers (hourly attendance, fixed weekly rate), plus their worker profiles and ID cards.',
      'Leave — employees request leave; finance/admin approve and balances update automatically.',
      'Attendance — review daily attendance and approve time-in extension requests.'
    ])}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
      ${cards.map((card,i)=>`
        <button class="hr-card" data-i="${i}" style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;padding:16px;background:var(--surface);border:1.5px solid var(--border);border-radius:14px;cursor:pointer;transition:border-color .15s,background .15s">
          <span style="font-size:26px">${emojiIcon(card.icon,26)}</span>
          <strong style="font-size:14px">${card.title}</strong>
          <span style="font-size:12px;color:var(--text-muted)">${card.desc}</span>
        </button>`).join('')}
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  c.querySelectorAll('.hr-card').forEach(b=>{
    b.addEventListener('click', ()=>cards[+b.dataset.i].go());
    b.addEventListener('mouseenter', ()=>{ b.style.borderColor='var(--primary-light)'; b.style.background='var(--surface2)'; });
    b.addEventListener('mouseleave', ()=>{ b.style.borderColor='var(--border)'; b.style.background='var(--surface)'; });
  });
};

// v14 Wave 4 Batch F4 — month-scoped THREE-WAY diff behind the same
// reconciliation page: for one month, every employee who shows up in ANY of
// (ledger PAY- rows / pay_runs/{month}.lines / salary_history mirror) gets a
// row comparing all three amounts. Unlike the all-time flag scan below (which
// only lists PROBLEMS it already knows how to name), this shows the full
// picture for a month — including a clean OK row — so a reader can eyeball
// completeness, not just chase flags. READ-ONLY: no writes anywhere in here.
async function buildThreeWayRecon(month, runData) {
  const run = runData || (await db.collection('pay_runs').doc(month).get().catch(()=>null))?.data() || {};
  const linesByUid = {};
  (run.lines||[]).forEach(l => { linesByUid[l.uid] = l; });

  // Same PAY-{month}-* / excl. -ER employer-share-leg query as the flag scan.
  const ledgerSnap = await db.collection('ledger')
    .where('refNumber','>=',`PAY-${month}-`)
    .where('refNumber','<', `PAY-${month}-` + String.fromCharCode(0xf8ff))
    .get().catch(()=>({docs:[]}));
  const ledgerByUid = {};
  ledgerSnap.docs.forEach(d => {
    const row = d.data();
    const ref = row.refNumber || '';
    const m = ref.match(new RegExp(`^PAY-${month}-(.+?)(?:-ER)?$`));
    if (!m || ref.endsWith('-ER')) return;
    const uid = m[1];
    // Deterministic refs (upsertByRef) should keep this to one row per uid;
    // sum defensively rather than silently drop a duplicate if that ever slips.
    ledgerByUid[uid] = (ledgerByUid[uid] || 0) + (row.amount || 0);
  });

  const shSnap = await db.collection('salary_history').where('runMonth','==', month).get().catch(()=>({docs:[]}));
  const historyByUid = {};
  shSnap.docs.forEach(d => { const sh = d.data(); if (sh.userId) historyByUid[sh.userId] = sh; });

  const uids = new Set([...Object.keys(linesByUid), ...Object.keys(ledgerByUid), ...Object.keys(historyByUid)]);
  return [...uids].map(uid => {
    const line = linesByUid[uid], hist = historyByUid[uid];
    const name = line?.name || hist?.userName || uid;
    // COMPARE LIKE WITH LIKE. The PAY-{month}-{uid} ledger row is posted as
    // `line.effectiveGross` (js/departments.js, the payslip debit leg) — a GROSS
    // payroll-expense figure. This report used to diff that straight against
    // line.finalPay and salary_history.finalPay, which are NET. They differ by
    // statutoryTotal + otherDeductions + caPlanned BY CONSTRUCTION, so every
    // employee was flagged MISMATCH every month with a five-figure delta, and a
    // real drift was indistinguishable from the noise — killing the one control
    // that would have caught a genuine ledger error.
    //
    // salary_history has no gross field, but it stores every component, so the
    // mirror's gross is reconstructable exactly the way money-core builds it:
    //   effectiveGross = netBeforeCA + statutoryTotal + otherDeductions
    // where netBeforeCA is mirrored as `netPay`. philhealth/pagibig are mirrored
    // in both casings (the WS21 legacy transition), so read either.
    const _num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
    const histGrossOf = h => {
      const netB = _num(h.netPay);
      if (netB == null) return null;                       // pre-mirror row — cannot derive
      const stat = (_num(h.sss) || 0)
                 + (_num(h.philhealth) ?? _num(h.philHealth) ?? 0)
                 + (_num(h.pagibig)    ?? _num(h.pagIbig)    ?? 0)
                 + (_num(h.tax) || 0);
      // …minus the unearned half, which money-core also excludes from
      // effectiveGross (absence/tardiness pay is not a company expense).
      // Absent on pre-2026-08 rows -> 0 -> the all-withheld original.
      return Math.round((netB + stat + (_num(h.deductions) || 0)
                              - (_num(h.deductionsUnearned) || 0)) * 100) / 100;
    };

    const ledgerAmt   = Object.prototype.hasOwnProperty.call(ledgerByUid, uid) ? ledgerByUid[uid] : null;
    const payrunGross = line ? (_num(line.effectiveGross)) : null;
    const histGross   = hist ? histGrossOf(hist) : null;
    const payrunNet   = line ? (_num(line.finalPay)) : null;
    const historyNet  = hist ? (_num(hist.finalPay) ?? _num(hist.netPay)) : null;

    const missing = [];
    if (ledgerAmt   == null) missing.push('LEDGER');
    if (payrunGross == null) missing.push('PAYRUN');
    if (histGross   == null) missing.push('HISTORY');

    let status, delta = null, netDelta = null;
    if (missing.length) {
      status = 'MISSING-IN-' + missing.join('/');
    } else {
      const vals = [ledgerAmt, payrunGross, histGross];
      delta = Math.round((Math.max(...vals) - Math.min(...vals)) * 100) / 100;
      // Second, independent check the old report never made at all: the two NET
      // mirrors must agree with each other. A gross-only diff would pass a run
      // where salary_history's take-home was hand-edited after disburse.
      if (payrunNet != null && historyNet != null) {
        netDelta = Math.round(Math.abs(payrunNet - historyNet) * 100) / 100;
      }
      status = delta > 0.01 ? 'MISMATCH'
             : (netDelta != null && netDelta > 0.01) ? 'NET-MISMATCH'
             : 'OK';
    }
    return { month, uid, name, ledgerAmt, payrunGross, histGross, payrunNet, historyNet, status, delta, netDelta };
  }).sort((a,b) => a.name.localeCompare(b.name));
}

function threeWayReconTableHTML(rows) {
  if (!rows.length) return `<div class="empty-state" style="padding:20px"><p style="color:var(--text-muted)">No payroll data found for this month in any of the three sources.</p></div>`;
  const statusBadge = r => r.status === 'OK'
    ? `<span class="badge badge-green">OK</span>`
    : r.status === 'MISMATCH'
      ? `<span class="badge badge-red">MISMATCH${r.delta!=null?` &nbsp;Δ ₱${fmt(r.delta)}`:''}</span>`
      : r.status === 'NET-MISMATCH'
        ? `<span class="badge badge-red">NET Δ ₱${fmt(r.netDelta||0)}</span>`
        : `<span class="badge badge-orange">${escHtml(r.status)}</span>`;
  const cell = v => v != null ? `₱${fmt(v)}` : '<span style="color:var(--text-muted)">—</span>';
  // Headers say GROSS explicitly: all three of these columns are the same
  // quantity (money-core's effectiveGross), which is the whole point of the
  // reconciliation. Net is shown alongside because the President reads this to
  // check take-home too, but it is compared only run-vs-history (the ledger
  // holds no net figure to compare it against).
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Employee</th><th>Ledger (gross)</th><th>Pay run (gross)</th><th>History (gross)</th><th>Net (run / history)</th><th>Status</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td style="font-weight:600">${escHtml(r.name)}</td>
      <td style="white-space:nowrap;font-size:12px">${cell(r.ledgerAmt)}</td>
      <td style="white-space:nowrap;font-size:12px">${cell(r.payrunGross)}</td>
      <td style="white-space:nowrap;font-size:12px">${cell(r.histGross)}</td>
      <td style="white-space:nowrap;font-size:12px">${cell(r.payrunNet)} / ${cell(r.historyNet)}</td>
      <td style="white-space:nowrap">${statusBadge(r)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ── Payroll reconciliation report (Part E Phase 20) — READ-ONLY. President-
// only. For every pay_run month, diffs ledger PAY- rows against the frozen
// run lines and salary_history mirror, flagging: (a) more than one PAY
// ledger row for the same month+uid, (b) a ledger amount that doesn't match
// the frozen run's gross, (c) salary_history rows with no
// matching frozen line (the pre-lock era's Path-B fingerprint). All three
// amount columns are GROSS (money-core's effectiveGross, which is what the
// PAY- ledger leg is posted as); net is checked separately, run-vs-history.
// No writes —
// any fix routes through financeDelete / a manual ledger entry.
async function openPayrollReconciliation() {
  // Wave 3 E-CALLERS — this modal (openPage's .page-panel host) sits outside
  // styles.css's print-visibility allowlist (#page-content/.payslip-print/
  // .bir-print/.print-target only), so it previously printed bare/blank.
  // This batch owns js/ only (not css/styles.css), so the fix is a
  // self-contained inline <style>: force everything else hidden under print,
  // show only .recon-print-wrap, and reveal the letterhead header/footer
  // (otherwise display:none, so screen rendering is unchanged) around the
  // live #recon-body table.
  const _reconLh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'PAYROLL RECONCILIATION',
    dateLabel: 'Generated ' + new Date().toLocaleString('en-PH'),
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Internal audit report'
  }) : null;
  const _reconPrintCss = _reconLh ? `<style>
    .recon-print-lh{display:none}
    @media print{
      body *{visibility:hidden!important}
      .recon-print-wrap,.recon-print-wrap *{visibility:visible!important}
      .recon-print-wrap{position:absolute;left:0;top:0;width:100%;padding:8mm}
      .recon-print-lh{display:block!important}
      @page{size:A4 portrait;margin:11mm 10mm 7mm}
    }
    ${_reconLh.printCSS}
  </style>` : '';
  const _reconPanel = openPage(`${emojiIcon('🔍',16)} Payroll Reconciliation`,
    `${_reconPrintCss}
    <div class="recon-print-wrap">
      <div class="recon-print-lh">${_reconLh ? _reconLh.headerHTML : ''}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <h4 style="margin:0">Three-Way Reconciliation — ledger vs pay run vs salary history</h4>
        <div class="no-print" style="display:flex;gap:8px;align-items:center">
          <select id="recon3-month-sel" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)"></select>
          <button class="btn-secondary btn-sm" id="recon3-csv-btn" disabled>${emojiIcon('📥',14)} Export CSV</button>
        </div>
      </div>
      <div id="recon3-body" style="padding:20px;text-align:center;color:var(--text-muted)">${window.skeletonHtml('table')}</div>
      <hr style="margin:22px 0;border-color:var(--border)"/>
      <h4 style="margin:0 0 10px">All-Time Flag Scan</h4>
      <div id="recon-body" style="padding:20px;text-align:center;color:var(--text-muted)">Scanning payroll history…</div>
      <div class="recon-print-lh">${_reconLh ? _reconLh.footerHTML : ''}</div>
    </div>`,
    `<button class="btn-secondary" id="recon-print-btn">${emojiIcon('🖨',16)} Print</button><button class="btn-secondary" id="recon-csv-btn" disabled>Export CSV (flags)</button><button class="btn-secondary" onclick="closeModal()">Close</button>`);

  // MOBILE FINANCE PASS (2026-08-08) — Print was `onclick="window.print()"`,
  // which §4 of this very file documents as a no-op inside the iOS
  // Add-to-Home-Screen webview. Routed through the shared openScreenPrintDoc →
  // openPrintableDoc host (Web-Share PDF on iOS standalone, window.print()
  // everywhere else). The snapshot is taken at CLICK time, so the async
  // three-way table and flag scan below are already filled in by then.
  _reconPanel?.querySelector('#recon-print-btn')?.addEventListener('click', () => {
    window.openScreenPrintDoc({
      source: _reconPanel.querySelector('.recon-print-wrap'),
      reveal: '.recon-print-lh',
      title: 'Payroll Reconciliation',
      barLabel: `${emojiIcon('🔍',16)} Payroll Reconciliation`,
      pageId: 'recon-doc-page'
    });
  });

  const runsSnap = await db.collection('pay_runs').get().catch(()=>({docs:[]}));
  const runDataByMonth = {}; runsSnap.docs.forEach(d => { runDataByMonth[d.id] = d.data(); });
  const runs = runsSnap.docs.map(d=>({ month:d.id, ...d.data() })).filter(r => r.lines && r.lines.length);

  // ── Three-way section: month picker + diff table for the selected month ──
  const allMonths = runsSnap.docs.map(d=>d.id).sort().reverse();
  const monthSel = _reconPanel.querySelector('#recon3-month-sel');
  if (monthSel) {
    monthSel.innerHTML = allMonths.length
      ? allMonths.map(m => `<option value="${m}">${escHtml(window.fmtMonthLabel ? window.fmtMonthLabel(m) : m)}</option>`).join('')
      : `<option value="">No pay runs yet</option>`;
  }
  let recon3Rows = [];
  const loadThreeWay = async (month) => {
    const body3 = _reconPanel.querySelector('#recon3-body');
    const csv3  = _reconPanel.querySelector('#recon3-csv-btn');
    if (!month) {
      if (body3) body3.innerHTML = `<div class="empty-state" style="padding:20px"><p style="color:var(--text-muted)">No pay runs recorded yet.</p></div>`;
      if (csv3) csv3.disabled = true;
      return;
    }
    if (body3) body3.innerHTML = window.skeletonHtml('rows');
    recon3Rows = await buildThreeWayRecon(month, runDataByMonth[month]);
    if (body3) { body3.innerHTML = threeWayReconTableHTML(recon3Rows); if (window.lucide) lucide.createIcons({ nodes: [body3] }); }
    if (csv3) csv3.disabled = !recon3Rows.length;
  };
  if (monthSel) {
    monthSel.addEventListener('change', () => loadThreeWay(monthSel.value));
    await loadThreeWay(monthSel.value || allMonths[0]);
  }
  _reconPanel.querySelector('#recon3-csv-btn')?.addEventListener('click', () => window.exportCSV('payroll-reconciliation-3way-' + (monthSel?.value||''), recon3Rows, [
    { key:'month', label:'Month' }, { key:'name', label:'Employee' }, { key:'uid', label:'Employee UID' },
    { key:'ledgerAmt', label:'Ledger Amount' }, { key:'payrunNet', label:'Payrun Net' }, { key:'historyNet', label:'History Net' },
    { key:'status', label:'Status' }, { key:'delta', label:'Delta' }
  ]));

  // ── All-time flag scan (existing Part E Phase 20 behavior, unchanged) ──
  const flags = [];

  for (const run of runs) {
    const month = run.month;
    const linesByUid = {};
    (run.lines||[]).forEach(l => { linesByUid[l.uid] = l; });

    // (a)/(b) — ledger PAY-{month}-* rows (excludes the -ER employer-share leg).
    const ledgerSnap = await db.collection('ledger')
      .where('refNumber','>=',`PAY-${month}-`)
      .where('refNumber','<', `PAY-${month}-` + String.fromCharCode(0xf8ff))
      .get().catch(()=>({docs:[]}));
    const byUid = {};
    ledgerSnap.docs.forEach(d => {
      const row = d.data();
      const ref = row.refNumber || '';
      const m = ref.match(new RegExp(`^PAY-${month}-(.+?)(?:-ER)?$`));
      if (!m || ref.endsWith('-ER')) return; // employer-share leg isn't the employee's net pay
      const uid = m[1];
      (byUid[uid] = byUid[uid] || []).push(row);
    });
    Object.keys(byUid).forEach(uid => {
      const rows = byUid[uid];
      const line = linesByUid[uid];
      const name = line?.name || rows[0]?.description || uid;
      if (rows.length > 1) {
        flags.push({ month, uid, name, issue:'Multiple PAY ledger rows for one employee/month', detail:`${rows.length} rows`, ledgerAmt: rows.reduce((s,r)=>s+(r.amount||0),0), runAmt: line?.effectiveGross||null });
      }
      if (line && Math.abs((rows[0]?.amount||0) - (line.effectiveGross||0)) > 0.01) {
        flags.push({ month, uid, name, issue:'Ledger amount ≠ frozen run amount', detail:`ledger ₱${fmt(rows[0]?.amount||0)} vs run ₱${fmt(line.effectiveGross||0)}`, ledgerAmt: rows[0]?.amount||0, runAmt: line.effectiveGross||0 });
      }
    });

    // (c) — salary_history rows with no matching frozen run line.
    const shSnap = await db.collection('salary_history').where('runMonth','==', month).get().catch(()=>({docs:[]}));
    shSnap.docs.forEach(d => {
      const sh = d.data();
      if (!linesByUid[sh.userId]) {
        flags.push({ month, uid: sh.userId, name: sh.userName||sh.userId, issue:'salary_history row with no matching run line', detail:'possible pre-lock (Path-B) double-write', ledgerAmt:null, runAmt:sh.finalPay||sh.netPay||null });
      }
    });
  }

  flags.sort((a,b) => (a.month<b.month?1:-1));
  const body = _reconPanel.querySelector('#recon-body');
  if (!body) return;
  body.innerHTML = !flags.length
    ? `<div class="empty-state" style="padding:30px"><div class="empty-icon">${emojiIcon('✅',44)}</div><p>No discrepancies found across ${runs.length} pay run(s).</p></div>`
    : `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Month</th><th>Employee</th><th>Issue</th><th>Detail</th><th>Ledger</th><th>Run</th></tr></thead>
        <tbody>${flags.map(f=>`<tr>
          <td style="white-space:nowrap;font-size:12px">${escHtml(window.fmtMonthLabel ? window.fmtMonthLabel(f.month) : f.month)}</td>
          <td style="font-weight:600">${escHtml(f.name)}</td>
          <td><span class="badge badge-red">${escHtml(f.issue)}</span></td>
          <td style="font-size:12px">${escHtml(f.detail)}</td>
          <td style="white-space:nowrap;font-size:12px">${f.ledgerAmt!=null?`₱${fmt(f.ledgerAmt)}`:'—'}</td>
          <td style="white-space:nowrap;font-size:12px">${f.runAmt!=null?`₱${fmt(f.runAmt)}`:'—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [body] });

  const csvBtn = _reconPanel.querySelector('#recon-csv-btn');
  if (csvBtn) {
    csvBtn.disabled = !flags.length;
    csvBtn.addEventListener('click', () => window.exportCSV('payroll-reconciliation', flags, [
      { key:'month', label:'Month' }, { key:'uid', label:'Employee UID' }, { key:'name', label:'Employee' },
      { key:'issue', label:'Issue' }, { key:'detail', label:'Detail' }, { key:'ledgerAmt', label:'Ledger Amount' }, { key:'runAmt', label:'Run Amount' }
    ]));
  }
}

// ── KPI month breakdown for display (Edit Payroll screen) ──────────────────
// money-core.js's window.computeKpiForMonth returns only the FINAL blended
// score (taskScore*0.7 + delivScore*0.3) — it doesn't hand back the raw
// "X of Y tasks" numerator/denominator the owner wants shown on the Edit
// Payroll screen. This mirrors computeKpiForMonth's exact in/out-of-scope
// loop (same t.assignedTo / taskDoneMonth / taskCreatedMonth rules — see
// money-core.js's header comment for the scope table) purely so that
// breakdown can be displayed; it is NEVER called by any pay computation.
// computeKpiForMonth itself remains the one and only source of the kpiScore
// that ever reaches computePayLine/pay, so this can't drift the two numbers
// apart from what's shown — the loop bodies are kept byte-identical on
// purpose.
function _kpiMonthBreakdown(userTasks, month) {
  const tasks = Array.isArray(userTasks) ? userTasks : [];
  let doneInM = 0, inScopeCount = 0;
  for (const t of tasks) {
    const dm = window.taskDoneMonth ? window.taskDoneMonth(t) : null;
    const cm = (window.taskCreatedMonth ? window.taskCreatedMonth(t) : '') || '';
    if (cm > month) continue; // didn't exist yet -> out of scope entirely
    if (dm === month || dm === '') { inScopeCount++; doneInM++; }
    else if (dm === null) { inScopeCount++; }
    else if (dm > month) { inScopeCount++; }
    // else: dm !== null && dm < month -> finished before M -> out of scope
  }
  return { doneInM, inScopeCount };
}

// ── Payroll hub — one screen, two chip-tabs (owner request, 2026-08-06) ───
// "Better if its just / Payroll / Then / Type a / Type b", and — asked which
// should open first — "Open on type a".
//
// The two payroll screens used to be two separate subtabs under two different
// names: HR called them "Payroll" + "Worker Payslips", Finance called the same
// pair "Payroll" + "HR Profiles". They are now ONE screen with two chip-tabs,
// reusing the Type A / Type B vocabulary the app already uses in the Employee
// Type selector:
//     Type A = regular staff, paid MONTHLY  (Compute → Verify → Disburse)
//     Type B = Production workers, paid WEEKLY (payslips, profiles, ID cards)
//
// This is a NAVIGATION wrapper ONLY. renderPayrollManagement and
// renderFinanceHRProfiles keep their exact signatures and are otherwise
// untouched — no payroll/statutory math, no Firestore query or write, and no
// rules are involved in this change.
//
// LAYOUT CONTRACT (load-bearing — do NOT flatten the pane into `host`):
//     host                             ← the container the caller passed
//     ├─ .chip-tabs.payroll-hub-tabs   ← the tab bar, owned by this function
//     └─ #payroll-hub-pane             ← the SUB-container handed to the two
//                                        renderers
// Both renderers own their container outright: renderPayrollManagement opens
// with `container.innerHTML = skeletonHtml('rows')`, and renderFinanceHRProfiles
// re-renders ITSELF on ~6 actions (add/edit/delete profile, ID modal, raise —
// see the `()=>renderFinanceHRProfiles(container,currentUser,currentRole)`
// callbacks below) using the SAME container it was handed. Giving them the
// PANE instead of `host` is exactly what makes those self-refreshes safe: they
// may rebuild #payroll-hub-pane as often as they like and the SIBLING tab bar —
// along with the listeners bindChipTabs attached to it — is never in the blast
// radius. The pane element is created once here and never replaced, so the
// closures that captured it stay valid across every self-refresh.
window.renderPayrollHub = async function(container, currentUser, currentRole, tab) {
  const host = container || (typeof deptContainer === 'function' ? deptContainer() : null);
  if (!host) return;
  const active = (tab === 'B') ? 'B' : 'A';   // anything else (incl. undefined) ⇒ Type A

  // ── RE-ENTRY GUARD — this is a MONEY bug if it is missing. ────────────────
  // The tab row is made inert during a load (below), which stops a second load
  // starting from a tab CLICK. It does nothing about re-entering this function,
  // and loadFinanceContent(…, 'Payroll') enters it on every Finance chip click.
  //
  // Why re-entry is not merely wasteful: both renderers write with
  // `container.innerHTML` but then bind with GLOBAL document.getElementById —
  // hr.js's pr-month-sel / gen-payroll-btn / payroll-tbody / print-payroll-btn,
  // and Type B's hrp-add-btn / hrp-sync-dir-btn. If a rebuild swaps the pane
  // while a render is still awaiting its Firestore reads, that render paints
  // into the DETACHED pane and then binds its handlers onto the LIVE one.
  // Measured: entering twice while the first load is in flight left TWO click
  // handlers on Compute, so one tap ran computePayRun TWICE. The reverse
  // completion order threw (getElementById → null) and painted the error into
  // the detached pane, where it is invisible and its retry is unreachable.
  //
  // So: mount ONCE per host, and route every later entry through the same
  // loader, which serialises (latest-wins) instead of starting a second render.
  if (typeof host._payrollHubLoad === 'function' && host.querySelector('#payroll-hub-pane')) {
    return host._payrollHubLoad(active);
  }

  // OPERATIONS TEAM (tab B) now has TWO sub-views (weekly run 2026-08-11):
  //   'run'     → window.renderWeeklyPayrollTab — the Monday–Sunday pay run,
  //               one press pays the week.
  //   'workers' → renderFinanceHRProfiles — the roster this tab used to BE:
  //               worker profiles, ID cards, the Clock kiosk, raise history,
  //               batch ID print, and the per-worker "Payslip" button that
  //               opens openPayslipGenerator. NOTHING here was deleted — the
  //               owner still needs the one-worker generator for off-cycle pay
  //               (final pay, an advance, a partial week) and for correcting a
  //               single line, so it keeps its own door.
  // The toggle lives in the HOST row, a SIBLING of #payroll-hub-pane, for the
  // same reason the chip tabs do: both sub-view renderers own the pane
  // outright and rebuild it on every self-refresh, so a control painted INSIDE
  // the pane would be destroyed (with its listener) by the next refresh. It is
  // also why the sub-view is a pane swap rather than an openPage overlay —
  // renderFinanceHRProfiles binds ~8 handlers by GLOBAL document.getElementById
  // (hrp-add-btn, hrp-sync-dir-btn, …), which is only safe while exactly one
  // copy of that markup is in the document. The pane is that one copy.
  let subB = 'run';
  host.innerHTML = `
    <div class="payroll-hub-bar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      ${window.chipTabs([
        { key:'A', label:'Office Team' },
        { key:'B', label:'Operations Team' }
      ], active, { cls:'payroll-hub-tabs' })}
      <button type="button" class="btn-secondary btn-sm" id="payroll-hub-sub-btn"
              style="margin-left:auto;display:none"></button>
    </div>
    <div id="payroll-hub-pane">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [host] });
  // Scoped to `host`, never document — openPage keeps a dying panel ~300ms and
  // a global lookup finds ITS copy of these ids (house rule; 811 lookups were
  // fixed for exactly this last week).
  const tabsRow = host.querySelector('.payroll-hub-tabs');
  const pane    = host.querySelector('#payroll-hub-pane');
  const subBtn  = host.querySelector('#payroll-hub-sub-btn');

  // Both renderers paint their own skeleton on their very first line, so a
  // switch never leaves stale content on screen and no extra skeleton is
  // needed here. What IS worth guarding is OVERLAP: each renderer awaits
  // several Firestore reads and only then binds listeners via
  // document.getElementById(...), so two loads in flight at once would leave
  // the first one's bindings hunting for the second one's DOM. The tab row is
  // therefore made inert for the duration of a load (same shape as
  // window.busy's button lock), and re-enabled in a `finally` so a failed read
  // can never strand the tabs.
  // Latest-wins serialisation. A load requested while one is in flight is
  // REMEMBERED, not started — the running render keeps sole ownership of the
  // pane (and therefore of the global ids it will bind), and the newest
  // requested tab renders once it finishes. Two renders can never overlap, so
  // the double-bind above is structurally impossible rather than merely
  // unlikely. `pending` holds only the newest request; rapid taps collapse.
  let busy = false, pending = null;
  const setActiveChip = (key) => {
    if (!tabsRow) return;
    tabsRow.querySelectorAll('.chip-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.chip === key);
    });
  };
  // The weekly run is a SEPARATE FILE loaded after this one (js/payroll-weekly.js
  // + js/screens/payroll-weekly-ui.js — see index.html). Resolved by window.*
  // name at CLICK/LOAD time, never at parse time, so if either file fails to
  // load the Operations tab degrades to the roster it has always shown rather
  // than to a blank pane — and the toggle that would lead nowhere is hidden.
  const hasWeeklyRun = () => typeof window.renderWeeklyPayrollTab === 'function';
  const paintSubBtn = (key) => {
    if (!subBtn) return;
    const show = (key === 'B') && hasWeeklyRun();
    subBtn.style.display = show ? '' : 'none';
    if (show) subBtn.textContent = (subB === 'run') ? 'Workers' : '← Pay Run';
  };
  const loadTab = async (key) => {
    const want = (key === 'B') ? 'B' : 'A';
    if (busy) { pending = want; return; }        // newest wins; the in-flight render finishes untouched
    busy = true;
    setActiveChip(want);                          // programmatic entries must move the chip too —
                                                  // bindChipTabs only toggles it on a real click
    paintSubBtn(want);
    if (tabsRow) { tabsRow.style.pointerEvents = 'none'; tabsRow.style.opacity = '0.6'; }
    if (subBtn)  { subBtn.disabled = true; }
    try {
      if (want === 'B') {
        // openWorkers is handed to the weekly screen so it can offer its OWN
        // route to the roster (a link in an empty state, "no rate — fix this
        // worker", etc.) without owning the toggle or the pane lifecycle.
        if (subB === 'run' && hasWeeklyRun()) {
          await window.renderWeeklyPayrollTab(pane, currentUser, currentRole, {
            openWorkers: () => { subB = 'workers'; loadTab('B'); }
          });
        } else {
          await renderFinanceHRProfiles(pane, currentUser, currentRole);
        }
      } else {
        await renderPayrollManagement(pane, currentUser, currentRole);
      }
    } catch (e) {
      _hrPanelError(pane, e, () => loadTab(want));
    } finally {
      busy = false;
      if (tabsRow) { tabsRow.style.pointerEvents = ''; tabsRow.style.opacity = ''; }
      if (subBtn)  { subBtn.disabled = false; }
      paintSubBtn(want);                          // hasWeeklyRun() may only have become true mid-load
      if (pending !== null) { const next = pending; pending = null; await loadTab(next); }
    }
  };
  host._payrollHubLoad = loadTab;                 // the re-entry guard above routes through this
  // Sub-view toggle. Routed through loadTab so it inherits the SAME
  // latest-wins serialisation as a chip click — flipping run↔workers while a
  // render is in flight can never leave two renderers painting one pane.
  if (subBtn) subBtn.addEventListener('click', () => {
    subB = (subB === 'run') ? 'workers' : 'run';
    paintSubBtn('B');
    loadTab('B');
  });

  // Scoped to the tab bar element itself (the finance.js precedent), never to
  // `host` — otherwise a chip rendered by a sub-screen inside the pane would
  // get swept up by the same querySelectorAll.
  window.bindChipTabs(tabsRow, (key) => { loadTab(key); });
  await loadTab(active);
};

async function renderPayrollManagement(container, currentUser, currentRole) {
  // 8-point #3 (Wave 7 Pass 3) — this screen had no loading state at all
  // before this pass: the container sat on whatever the previous Finance
  // subtab left behind while RaiseFlow.applyDueRaises + the three reads
  // below were in flight. renderFinanceHRProfiles right below already does
  // this; matching it here.
  container.innerHTML = window.skeletonHtml('rows');
  // v12 WS23 — apply any due-dated raise BEFORE the base salary is read, so
  // Compute/the table preview always see the current base. Safe to re-run.
  await window.RaiseFlow.applyDueRaises('payroll').catch(()=>{});
  const [usersSnap, histSnap, delReqSnap, payRunsSnap, earliestHistSnap, wpSnap] = await Promise.all([
    fetchUsersWithPayroll(),
    db.collection('salary_history').orderBy('month','desc').limit(200).get().catch(()=>({docs:[]})),
    db.collection('payroll_delete_requests').where('status','==','pending').get().catch(()=>({docs:[]})),
    // Payroll recall spec §B1/§B2 — one full pay_runs read (small collection,
    // one doc per month) drives both the month-dropdown union and the
    // unpaid-months card below; fetched once here, not per-render.
    db.collection('pay_runs').get().catch(()=>({docs:[]})),
    db.collection('salary_history').orderBy('month').limit(1).get().catch(()=>({docs:[]})),
    // ONE ROSTER (2026-08-09). The weekly bridge is read ONCE, here, and shared
    // by the "paid weekly" banner AND the table preview below — which used to
    // fetch it separately, so the banner's count and the preview's exclusion
    // list were computed from two different reads of the same collection.
    (typeof window.dbCachedGet === 'function'
      ? window.dbCachedGet('worker_profiles', () => db.collection('worker_profiles').get(), 60000)
      : db.collection('worker_profiles').get()).catch(()=>({docs:[]}))
  ]);
  // Exclude ALL external partners from the monthly run — they are not Barro
  // payroll. A partner can present as role 'partner', a Brilliant-Steel-only
  // member (the partner company), OR a user titled "Partner" whose role is still
  // 'employee'/'agent' (which is why the old role-only filter let them through).
  const isExternalPartner = (u) => {
    if (u.role === 'partner') return true;
    if (typeof u.title === 'string' && u.title.trim().toLowerCase() === 'partner') return true;
    const depts = Array.isArray(u.departments) ? u.departments : (u.department ? [u.department] : []);
    return depts.length === 1 && depts[0] === 'Brilliant Steel';
  };
  const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>!isExternalPartner(u));
  // ── THE DOUBLE-PAY GUARD, roster side ───────────────────────────
  // A person can be paid weekly by TWO independent facts, and the engine
  // (computePayRun, js/departments.js) honours both:
  //   1. payroll/{uid}.payClass === 'production'   — declared Operations Team
  //   2. an ACTIVE worker_profiles doc whose linkedUid is this uid — the
  //      structural bridge, which can exist even while payClass is 'regular'
  // This roster used to test (1) ONLY, so a 'regular'-class person bridged to a
  // weekly worker profile was listed as a monthly employee here and then
  // silently dropped by Compute. Testing the SAME union the engine tests is
  // what keeps the guard and the screen from disagreeing — and the guard gets
  // MORE load-bearing, not less, as the two populations converge on one create
  // path. `status !== 'inactive'` mirrors js/departments.js exactly: an
  // offboarded worker profile must NOT keep someone out of the monthly run.
  const linkedUids = new Set(
    (wpSnap.docs || []).map(d => d.data())
      .filter(p => p && p.status !== 'inactive' && p.linkedUid)
      .map(p => p.linkedUid)
  );
  // ONE EXPRESSION with the engine — window.monthlyRunSkipReason (js/departments.js)
  // is what computePayRun itself calls. Anything it flags 'production' or
  // 'linked-worker-profile' is paid weekly; 'removed' / 'excluded: …' are
  // separate reasons the preview reports on its own line below, so they stay in
  // `employees` here and are surfaced there rather than vanishing silently.
  // No exclusion map passed ON PURPOSE. This one feeds isPaidWeekly only, which
  // asks about 'production' / 'linked-worker-profile' — the two permanent
  // double-pay reasons, evaluated BEFORE any exclusion in the guard. Handing it
  // a period map would change nothing and would imply this predicate is
  // period-sensitive, which it must not become: the weekly/monthly split is a
  // property of the person, not of the month.
  const _skipOf = (u) => window.monthlyRunSkipReason(u, linkedUids);
  const isPaidWeekly = (u) => ['production','linked-worker-profile'].includes(_skipOf(u));
  // Production-class staff are paid WEEKLY via Payroll → Operations Team,
  // NOT in the monthly run. Excluding them here is the single-source fix that
  // stops a production worker being paid both weekly AND monthly (double pay).
  const productionStaff = allStaff.filter(isPaidWeekly);
  const employees = allStaff.filter(u=>!isPaidWeekly(u))
    .sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  const history   = histSnap.docs.map(d=>({id:d.id,...d.data()}));
  const delReqs   = delReqSnap.docs.map(d=>({id:d.id,...d.data()}));
  const pendingDelIds = new Set(delReqs.map(r=>r.historyId));
  const canFinance = isFinancePriv();
  const isPres     = isRealPresident(currentUser);
  const months    = [...new Set(history.map(h=>h.month))].sort().reverse();
  const thisMonth = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10)).slice(0,7); // Manila YYYY-MM

  // ── Unpaid-months recall (payroll recall spec §B1/§B2) ──────────────────
  // Fixes G1: the month dropdown used to only list salary_history months +
  // "current" — a month that was never disbursed has no salary_history rows,
  // so it wasn't even selectable. Build the full PAYROLL_EPOCH..thisMonth
  // range instead (plain string arithmetic on 'YYYY-MM', never Date, so this
  // is TZ-proof and matches money-core's own date-math convention).
  function _prNextMonth(m) {
    let y = parseInt(m.slice(0,4),10), mo = parseInt(m.slice(5,7),10);
    mo++; if (mo > 12) { mo = 1; y++; }
    return `${y}-${String(mo).padStart(2,'0')}`;
  }
  function _prEnumerateMonths(start, end) {
    const out = []; let cur = start, guard = 0;
    while (cur <= end && guard < 3000) { out.push(cur); cur = _prNextMonth(cur); guard++; }
    return out;
  }
  const stateByMonth = {};
  payRunsSnap.docs.forEach(d => {
    const dd = d.data();
    stateByMonth[d.id] = { state: dd.state || 'draft', employeeCount: dd.employeeCount, totalNet: dd.totalNet };
  });
  const payRunMonths     = payRunsSnap.docs.map(d=>d.id).filter(id=>/^\d{4}-\d{2}$/.test(id));
  const earliestPayRunMo = payRunMonths.length ? payRunMonths.slice().sort()[0] : null;
  const earliestHistMo   = earliestHistSnap.docs[0] ? (earliestHistSnap.docs[0].data().month || null) : null;
  // v14 fix (owner: "June was not disbursed... why is it not reflected") — a
  // month that was NEVER computed has no pay_run/salary_history doc, so the old
  // epoch (earliest pay_run = July) hid June entirely. Always surface at least
  // the last few months so delayed never-run months appear; extend further back
  // when older pay_run/history data exists.
  const _prMonthsAgo = (mo, n) => { const [y,mm]=mo.split('-').map(Number); const d=new Date(Date.UTC(y, mm-1-n, 1)); return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'); };
  const _minEpoch = _prMonthsAgo(thisMonth, 3);
  const _rawEpoch = [earliestPayRunMo, earliestHistMo, thisMonth].filter(Boolean).sort()[0] || thisMonth;
  const PAYROLL_EPOCH    = _rawEpoch < _minEpoch ? _rawEpoch : _minEpoch;
  const allMonths        = _prEnumerateMonths(PAYROLL_EPOCH, thisMonth); // ascending, PAYROLL_EPOCH..thisMonth inclusive
  const monthsDesc        = allMonths.slice().sort().reverse();
  const monthOptionsHtml = monthsDesc.map(m => {
    const label = window.fmtMonthLabel(m);
    const st    = stateByMonth[m]?.state;
    const isPast = m < thisMonth;
    const suffix = m===thisMonth ? ' (Current)' : (isPast && st !== 'disbursed' ? ' — ⚠ not disbursed' : '');
    return `<option value="${m}"${m===thisMonth?' selected':''}>${label}${suffix}</option>`;
  }).join('');

  // v12 WS23 — scheduled/pending raise counts for the banner below.
  const _prSnap = await db.collection('pending_raises').where('status','in',['scheduled','pending_approval']).get().catch(()=>({docs:[]}));
  const _nm = thisMonth;
  const _upcomingRaises = _prSnap.docs.filter(d=>d.data().status==='scheduled' && (d.data().effectiveMonth||'') > _nm).length;
  const _pendingRaises  = _prSnap.docs.filter(d=>d.data().status==='pending_approval').length;
  const raiseBanner = (_upcomingRaises||_pendingRaises)
    ? `<div class="info-banner" style="margin:8px 0">${emojiIcon('💸',16)} ${_upcomingRaises} scheduled raise(s) upcoming${_pendingRaises?` · ${_pendingRaises} awaiting President approval`:''}. <button class="btn-secondary btn-sm" id="pr-view-raises">View</button></div>`
    : '';

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <select id="pr-month-sel" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">
        ${monthOptionsHtml}
      </select>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn-primary btn-sm" id="gen-payroll-btn">Compute Payroll</button>
        <button class="btn-secondary btn-sm" id="raise-history-btn">${emojiIcon('💸',16)} Raise History</button>
        <button class="btn-secondary btn-sm" id="print-payroll-btn">${emojiIcon('🖨',16)} Print All</button>
        ${(typeof isRealPresident === 'function' && isRealPresident()) ? `<button class="btn-secondary btn-sm" id="payroll-recon-btn">${emojiIcon('🔍',16)} Reconciliation</button>` : ''}
      </div>
    </div>
    ${raiseBanner}
    <div id="pr-unpaid-card" style="margin-bottom:14px"></div>
    <div id="pay-run-strip" style="margin-bottom:14px"></div>
    ${productionStaff.length?`<div style="font-size:12px;color:var(--text-2);background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:12px">${emojiIcon('🏭',16)} <strong>${productionStaff.length}</strong> ${productionStaff.length!==1?'people are':'person is'} paid <strong>weekly</strong> via <strong>Payroll → Operations Team</strong> and ${productionStaff.length!==1?'are':'is'} excluded from this monthly run to avoid double payment — Operations Team pay class, or linked to an active worker profile. ${productionStaff.length!==1?'They':'This person'} cannot appear in both runs.</div>`:''}
    <div class="card">
      <div class="card-body" style="padding:0">
        <div id="payroll-table-caption" style="padding:8px 16px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border)"></div>
        <div class="table-wrap">
          <table class="data-table table-cards" id="payroll-table">
            <thead><tr>
              <th>Photo</th><th>Employee</th><th>ID</th><th>Department</th>
              <th>Base</th><th>Allowance</th><th>Deductions</th>
              <th>SSS</th><th>PhilHealth</th><th>Pag-IBIG</th>
              <th>Tax</th><th>Cash Adv</th><th>Net Pay</th><th></th>
            </tr></thead>
            <tbody id="payroll-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>
    ${isPres && delReqs.length ? `
    <div class="card" style="margin-top:14px;border:2px solid var(--danger)">
      <div class="card-header" style="background:rgba(220,53,69,0.08)"><h3 style="color:var(--danger)">${emojiIcon('⚠️',20)} Pending Payroll Delete Approvals (${delReqs.length})</h3></div>
      <div class="card-body" style="padding:0">
        <div class="table-wrap"><table class="data-table table-cards no-toggle" id="del-req-table">
          <thead><tr><th>Month</th><th>Employee</th><th>Requested By</th><th>Reason</th><th></th></tr></thead>
          <tbody>${delReqs.map(r=>`<tr>
            <td data-label="Month">${r.month||'—'}</td>
            <td data-label="Employee">${escHtml(r.userName||'—')}</td>
            <td data-label="Requested By" style="font-size:11px">${escHtml(r.requestedByName||'—')}</td>
            <td data-label="Reason" style="font-size:11px;color:var(--text-muted)">${escHtml(r.reason||'—')}</td>
            <td style="white-space:nowrap">
              <button class="btn-primary btn-sm del-req-approve" data-req-id="${r.id}" data-hist-id="${r.historyId}" title="Approve deletion">${emojiIcon('✓',16)} Approve</button>
              <button class="btn-secondary btn-sm del-req-deny" data-req-id="${r.id}" data-req-by="${r.requestedBy}" style="margin-left:4px" title="Deny">${emojiIcon('✕',16)} Deny</button>
            </td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>` : ''}
    <div class="card" style="margin-top:14px">
      <div class="card-header"><h3>Payroll History</h3></div>
      <div class="card-body" style="padding:0">
        ${!history.length?'<div class="empty-state" style="padding:20px"><p>No payroll records yet.</p></div>':
          `<div class="table-wrap"><table class="data-table table-cards" id="payroll-history-table">
            <thead><tr><th>Month</th><th>Employee</th><th>Base</th><th>Allowance</th><th>Deductions</th><th>Net Pay</th><th>Final Pay</th><th>Ledger</th>${canFinance?'<th></th>':''}</tr></thead>
            <tbody>${history.slice(0,50).map(h=>`<tr class="ph-row">
              <td class="tc-avatar" style="white-space:nowrap">${h.month||'—'}</td>
              <td class="tc-name">${escHtml(h.userName||'—')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
              <td class="tc-detail" data-label="Base">₱${fmt(h.salary)}</td>
              <td class="tc-detail" data-label="Allowance" style="color:var(--success)">+₱${fmt(h.allowance)}</td>
              <td class="tc-detail" data-label="Deductions" style="color:var(--danger)">-₱${fmt(h.deductions)}</td>
              <td class="tc-detail" data-label="Net Pay">₱${fmt(h.netPay)}</td>
              <td class="tc-net"><strong>₱${fmt(h.finalPay)}</strong></td>
              <td class="tc-detail" data-label="Ledger"><span class="badge badge-blue" style="font-size:10px">Expense</span></td>
              ${canFinance?`<td class="tc-actions" style="white-space:nowrap">
                <button class="btn-secondary btn-sm hist-edit-btn" data-id="${h.id}" title="Edit" aria-label="Edit payroll record">${emojiIcon('✎',16)}</button>
                ${pendingDelIds.has(h.id)
                  ? `<button class="btn-secondary btn-sm" style="margin-left:4px;opacity:0.6;cursor:default" disabled title="Awaiting president approval" aria-label="Awaiting president approval">${emojiIcon('⏳',16)}</button>`
                  : `<button class="btn-danger btn-sm hist-del-btn" data-id="${h.id}" data-name="${escHtml(h.userName||'')}" data-month="${h.month||''}" title="${isPres?'Delete':'Request deletion'}" aria-label="${isPres?'Delete':'Request deletion'} payroll record" style="margin-left:4px">${isPres?`${emojiIcon('✕',16)}`:`${emojiIcon('🗑',16)}`}</button>`
                }
              </td>`:''}
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  // Card view (≤700px) — tap a payroll-history row to reveal the full breakdown.
  container.querySelectorAll('tr.ph-row').forEach(tr => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a')) return;
      tr.classList.toggle('tc-expanded');
    });
  });

  // ── History edit (Finance & above) ──────────────
  if (canFinance) {
    container.querySelectorAll('.hist-edit-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const hid = btn.dataset.id;
        const rec = history.find(h => h.id === hid);
        if (!rec) return;
        const _panel = openPage(`Edit Payroll Record — ${escHtml(rec.userName||'?')} (${escHtml(rec.month||'?')})`, `
          <div class="form-row">
            <div class="form-group"><label>Base Salary</label><input id="hpe-salary" type="number" value="${rec.salary||0}" inputmode="decimal"/></div>
            <div class="form-group"><label>Allowance</label><input id="hpe-allow" type="number" value="${rec.allowance||0}" inputmode="decimal"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Deductions</label><input id="hpe-deduct" type="number" value="${rec.deductions||0}" inputmode="decimal"/></div>
            <div class="form-group"><label>Net Pay</label><input id="hpe-net" type="number" value="${rec.netPay||0}" inputmode="decimal"/></div>
          </div>
          <div class="form-group"><label>Final Pay</label><input id="hpe-final" type="number" value="${rec.finalPay||0}" inputmode="decimal"/></div>
          <div class="form-group"><label>Notes (optional)</label><input id="hpe-notes" type="text" value="${escHtml(rec.notes||'')}" placeholder="e.g. 13th month included"/></div>
        `, `<button class="btn-primary" id="save-hpe-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
        // ⚠ SCOPED TO THIS PANEL, NOT document.
        // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second
        // record inside that window and two panels carry the same element ids at
        // once — document.getElementById() returns the FIRST match in document
        // order, which is the DYING panel. At bind time the handler lands on a
        // button nobody can see (the visible one gets none); inside the handler
        // the field reads pull the PREVIOUS record's values and write them onto
        // THIS record. Corporate Secretary report, reproduced 2026-08-10.
        const $hpe = (id) => _panel.querySelector('#' + id);

        $hpe('save-hpe-btn').addEventListener('click', async () => {
          // H2 fix — every other money-posting path guards on assertPeriodOpen
          // before writing; this edit modal didn't, so a closed month could be
          // silently re-posted. Mirrors the try/catch-return pattern used elsewhere
          // (assertPeriodOpen already shows its own toast on rejection).
          try { await window.assertPeriodOpen(rec.month + '-01'); } catch (e) { return; }
          const salary    = parseFloat($hpe('hpe-salary').value)||0;
          const allowance = parseFloat($hpe('hpe-allow').value)||0;
          const deductions= parseFloat($hpe('hpe-deduct').value)||0;
          const netPay    = parseFloat($hpe('hpe-net').value)||0;
          const finalPay  = parseFloat($hpe('hpe-final').value)||0;
          const notes     = $hpe('hpe-notes').value.trim();
          await db.collection('salary_history').doc(hid).update({
            salary, allowance, deductions, netPay, finalPay,
            ...(notes ? { notes } : {}),
            editedBy: currentUser.uid,
            editedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          // H1 fix — disbursePayRun posts this same PAY-{month}-{uid} row as
          // line.effectiveGross (netBeforeCA + statutoryTotal + otherDeductions),
          // a GROSS payroll-expense figure — NOT net finalPay. salary_history
          // doesn't store effectiveGross directly, so rebuild it the same way from
          // the record's own fields: sss/philhealth/pagibig/tax aren't editable in
          // this form, so rec's already-frozen values are still correct post-edit.
          const statutoryTotal = (rec.sss||0) + (rec.philhealth||0) + (rec.pagibig||0) + (rec.tax||0);
          // …less the unearned half of Other Deductions, which money-core also
          // excludes from effectiveGross (absence/tardiness pay is not a company
          // expense). The edit form does not expose the split, so carry forward
          // whatever this record was frozen with; absent on pre-2026-08 rows,
          // where 0 reproduces the original all-withheld figure exactly.
          // Clamped to the (possibly edited) deductions total for the same
          // reason money-core clamps: a lowered total must not leave a stale
          // unearned amount larger than it.
          const unearned = Math.min(Math.max(rec.deductionsUnearned || 0, 0), deductions);
          const effectiveGross = netPay + statutoryTotal + deductions - unearned;
          // Keep ledger entry in sync
          const ledgerRef = `PAY-${rec.month}-${rec.userId}`;
          const ledgerSnap = await db.collection('ledger').where('refNumber','==',ledgerRef).limit(1).get().catch(()=>({docs:[]}));
          const _rollupSync = window.Ledger && typeof window.Ledger._syncRollup === 'function' ? window.Ledger._syncRollup : null;
          if (!ledgerSnap.docs.length && rec.userId) {
            // Individual entry didn't exist yet — create it
            const _newLedgerRow = {
              date: rec.month + '-01',
              type: 'debit',
              accountType: 'expense',
              description: `Payslip — ${rec.userName||'?'} (${window.fmtMonthLabel(rec.month)})`,
              amount: effectiveGross,
              category: 'Payroll Expense',
              source: 'Finance',
              refNumber: ledgerRef,
              addedBy: currentUser.uid,
              addedByName: window.userProfile?.displayName || currentUser.email,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await db.collection('ledger').add(_newLedgerRow);
            // v14 Wave 4 Batch F2 — this poster writes .add() directly (not
            // through Ledger.post), so keep finance_rollup in sync here too.
            if (_rollupSync) await _rollupSync(_newLedgerRow, +1);
          } else if (ledgerSnap.docs.length) {
            const _oldLedgerRow = ledgerSnap.docs[0].data();
            await ledgerSnap.docs[0].ref.update({ amount: effectiveGross });
            if (_rollupSync) {
              await _rollupSync(_oldLedgerRow, -1);
              await _rollupSync({ ..._oldLedgerRow, amount: effectiveGross }, +1);
            }
          }
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
          closeModal();
          Notifs.success('Payroll record updated!');
          loadFinanceContent(currentUser, currentRole, 'Payroll');
        });
      });
    });

    // ── Delete: president deletes directly; finance requests approval ──
    container.querySelectorAll('.hist-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const hid   = btn.dataset.id;
        const name  = btn.dataset.name;
        const month = btn.dataset.month;

        if (isPres) {
          if (!(await confirmDialog({message:`Delete payroll record for ${escHtml(name||'?')} (${month||'?'})? This cannot be undone.`, danger:true, html:true}))) return;
          // Cascade handles the linked PAY- ledger entry AND restores any cash-advance
          // balances this run deducted (reads the doc's own fields — no fragile split).
          await window.financeExecuteDelete('salary_history', hid);
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
          Notifs.success('Record deleted');
          loadFinanceContent(currentUser, currentRole, 'Payroll');
        } else {
          // Finance requests president approval
          openModal('Request Payroll Record Deletion', `
            <p style="margin-bottom:12px;color:var(--text-muted);font-size:13px">You are requesting deletion of the payroll record for <strong>${escHtml(name)}</strong> (${month}). The President must approve before it is deleted.</p>
            <div class="form-group"><label>Reason for deletion</label><input id="del-reason" placeholder="e.g. Duplicate entry, incorrect data…"/></div>
          `, `<button class="btn-primary" id="submit-del-req-btn">Submit for Approval</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
          document.getElementById('submit-del-req-btn').addEventListener('click', async () => {
            const reason = document.getElementById('del-reason').value.trim();
            if (!reason) { Notifs.showToast('Please enter a reason.','error'); return; }
            const rec = history.find(h => h.id === hid);
            await db.collection('payroll_delete_requests').add({
              historyId:       hid,
              userId:          rec?.userId || '',
              userName:        name,
              month,
              reason,
              requestedBy:     currentUser.uid,
              requestedByName: window.userProfile?.displayName || currentUser.email,
              status:          'pending',
              createdAt:       firebase.firestore.FieldValue.serverTimestamp()
            });
            await Notifs.sendToOwner({
              title: '🗑 Payroll Delete Request',
              body:  `${window.userProfile?.displayName||currentUser.email} requested deletion of ${name}'s ${month} payroll record. Reason: ${reason}`,
              icon: '🗑', type: 'payroll_delete_request', link: 'approvals'
            });
            closeModal();
            Notifs.success('Deletion request sent to President for approval.');
            loadFinanceContent(currentUser, currentRole, 'Payroll');
          });
        }
      });
    });

    // ── President: approve or deny pending delete requests ──────────
    if (isPres) {
      container.querySelectorAll('.del-req-approve').forEach(btn => {
        btn.addEventListener('click', async () => {
          const reqId  = btn.dataset.reqId;
          const histId = btn.dataset.histId;
          const req    = delReqs.find(r => r.id === reqId);
          if (!(await confirmDialog({message:`Approve deletion of ${escHtml(req?.userName||'?')} (${req?.month||'?'}) payroll record?`, danger:true, html:true}))) return;
          btn.disabled = true;
          // Guard against re-running an already-resolved request.
          const _chk = await db.collection('payroll_delete_requests').doc(reqId).get().catch(()=>null);
          if (_chk && _chk.exists && _chk.data().status !== 'pending') { Notifs.showToast('Already handled.'); loadFinanceContent(currentUser, currentRole, 'Payroll'); return; }
          // Cascade removes the PAY- ledger debit and restores deducted cash advances.
          await window.financeExecuteDelete('salary_history', histId);
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
          await db.collection('payroll_delete_requests').doc(reqId).update({ status:'approved', resolvedAt: firebase.firestore.FieldValue.serverTimestamp() });
          if (req?.requestedBy) {
            await Notifs.send(req.requestedBy, {
              title: '✅ Payroll Delete Approved',
              body: `Your request to delete ${req.userName}'s ${req.month} payroll record has been approved.`,
              icon: '✅', type: 'payroll_delete_approved', link: 'approvals'
            });
          }
          Notifs.success('Record deleted and requester notified.');
          loadFinanceContent(currentUser, currentRole, 'Payroll');
        });
      });

      container.querySelectorAll('.del-req-deny').forEach(btn => {
        btn.addEventListener('click', async () => {
          const reqId  = btn.dataset.reqId;
          const reqBy  = btn.dataset.reqBy;
          const req    = delReqs.find(r => r.id === reqId);
          await db.collection('payroll_delete_requests').doc(reqId).update({ status:'denied', resolvedAt: firebase.firestore.FieldValue.serverTimestamp() });
          if (reqBy) {
            await Notifs.send(reqBy, {
              title: '❌ Payroll Delete Denied',
              body: `Your request to delete ${req?.userName||'?'}'s ${req?.month||'?'} payroll record was denied by the President.`,
              icon: '❌', type: 'payroll_delete_denied', link: 'approvals'
            });
          }
          Notifs.error('Request denied and requester notified.');
          loadFinanceContent(currentUser, currentRole, 'Payroll');
        });
      });
    }
  }

  // ── Unpaid-months recall card (payroll recall spec §B2) ─────────────────
  // Every month from PAYROLL_EPOCH through thisMonth that isn't 'disbursed'
  // yet, oldest first — "recall all records ... for each month that has not
  // been disbursed" (owner's verbatim ask). Open just switches the existing
  // #pr-month-sel + fires its change handler — no money action is duplicated
  // here, the Compute/Verify/Disburse buttons stay on the pay-run strip below.
  async function loadUnpaidStrip() {
    const card = document.getElementById('pr-unpaid-card');
    if (!card) return;
    const unpaidMonths = allMonths.filter(m => (stateByMonth[m]?.state) !== 'disbursed').sort();
    if (!unpaidMonths.length) {
      card.innerHTML = `<div class="info-banner">${emojiIcon('✓',16)} All months through ${window.fmtMonthLabel(thisMonth)} are disbursed.</div>`;
      return;
    }
    const BADGE_MAP = {
      'never-run': ['Never run','badge-gray'], computed:['Computed','badge-blue'],
      verified:['Verified','badge-green'], disbursing:['Disbursing (locked)','badge-amber']
    };
    const _statVerified = (m) => {
      const y = m.slice(0,4);
      return !!(window.STATUTORY && window.STATUTORY[y] && window.STATUTORY[y].verified === true);
    };
    const rows = await Promise.all(unpaidMonths.map(async m => {
      const st = stateByMonth[m]?.state || 'never-run';
      const [label, badgeCls] = BADGE_MAP[st] || ['Unknown','badge-gray'];
      const info = stateByMonth[m];
      const countNet = (info && info.employeeCount != null)
        ? `<div style="font-size:11px;color:var(--text-muted)">${info.employeeCount} staff · ₱${fmt(info.totalNet||0)}</div>` : '';
      let closed = false;
      try { closed = await window.isPeriodClosed(m + '-01'); } catch (_) { /* unknown — best-effort */ }
      const lockNote = closed ? `<div style="font-size:11px;color:var(--danger)">${emojiIcon('🔒',10)} Period closed — ask the President to reopen it first</div>` : '';
      const statNote = _statVerified(m) ? '' : `<div style="font-size:11px;color:var(--warning)">${emojiIcon('⚠',10)} Disburse blocked: statutory rates unverified</div>`;
      return `<div class="pr-unpaid-row" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <strong>${window.fmtMonthLabel(m)}</strong>
          <span class="badge ${badgeCls}" style="font-size:10px;margin-left:6px">${label}</span>
          ${countNet}${lockNote}${statNote}
        </div>
        <button class="btn-secondary btn-sm pr-unpaid-open" data-month="${m}">Open</button>
      </div>`;
    }));
    card.innerHTML = `<div class="card"><div class="card-header"><h3>${unpaidMonths.length} month(s) not yet disbursed</h3></div><div class="card-body">${rows.join('')}</div></div>`;
    card.querySelectorAll('.pr-unpaid-open').forEach(btn => {
      btn.addEventListener('click', () => {
        const sel = document.getElementById('pr-month-sel');
        if (!sel) return;
        sel.value = btn.dataset.month;
        sel.dispatchEvent(new Event('change'));
      });
    });
  }

  // Per-employee CA plan (WS22's CashAdvance.planFor), read by both the table
  // preview and the Edit Payroll modal — one shared computation, not two.
  let _planByUser = {};

  async function loadPayrollTable(month) {
    const tbody = document.getElementById('payroll-tbody');
    tbody.innerHTML = '<tr><td colspan="14" style="padding:14px 20px"><div class="skl-text" style="width:92%"></div></td></tr>'.repeat(3);
    const captionEl = document.getElementById('payroll-table-caption');

    // ── Frozen-run mode (payroll recall spec §B3 — kills G2) ───────────────
    // Once a month has been Computed, ITS frozen lines[] are the single
    // source of truth for that month — not "today's live pay settings"
    // re-evaluated retroactively (the bug that made "viewing July" show
    // today's salaries). Falls through to the live-preview branch below only
    // when no run doc exists yet for this month.
    // null from this catch is AMBIGUOUS — it means both "no run yet" (the normal
    // case for an uncomputed month) and "the read failed". They render
    // identically and mean opposite things: the second would show a person
    // removed from THIS month as payable. Distinguish them so the screen can say.
    let _runReadFailed = false;
    const runDoc  = await db.collection('pay_runs').doc(month).get()
      .catch(() => { _runReadFailed = true; return null; });
    const runData = (runDoc && runDoc.exists) ? runDoc.data() : null;
    if (runData && Array.isArray(runData.lines) && runData.lines.length) {
      const computedAtLabel = (runData.computedAt && typeof runData.computedAt.toDate === 'function')
        ? window.fmtManila(runData.computedAt) : '';
      if (captionEl) captionEl.innerHTML =
        `Showing the computed run (state: <strong>${escHtml(runData.state||'computed')}</strong>${runData.computedByName?`, computed by ${escHtml(runData.computedByName)}`:''}${computedAtLabel?` at ${computedAtLabel}`:''})`;
      const canAdjust = runData.state === 'computed' && canFinance;
      tbody.innerHTML = runData.lines.map(line => {
        const u = employees.find(e=>e.id===line.uid) || null;
        const depts = u ? ((Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—') : '—';
        const editedBadge = line.overridden
          ? ` <span class="badge badge-orange" title="${escHtml(line.overrideMeta?.note||'')}" style="font-size:10px">edited</span>` : '';
        // Money-adjacent, display-only "note to employee" (see openEmployeeNoteModal
        // below) — this badge only reflects the pre-disburse pay_runs.employeeNotes
        // map; a post-disburse correction lives on the salary_history mirror
        // instead (immutable pay_runs can't be touched after disburse) and won't
        // move this at-a-glance badge, only the payslip/employee view.
        const noteBadge = (runData.employeeNotes && runData.employeeNotes[line.uid] && runData.employeeNotes[line.uid].text)
          ? ` <span class="badge badge-blue" title="${escHtml(runData.employeeNotes[line.uid].text)}" style="font-size:10px">note</span>` : '';
        const caCell = (line.caPlanned||0) > 0
          ? `<div style="color:var(--danger);white-space:nowrap">-₱${fmt(line.caPlanned)}</div><div style="font-size:10px;color:var(--text-muted)">bal ₱${fmt(line.caBalance)}</div>`
          : '<span style="color:var(--text-muted)">—</span>';
        return `<tr class="pr-row">
          <td class="tc-avatar" style="text-align:center">
            <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--on-primary);font-size:14px;margin:0 auto">
              ${u&&u.photoUrl?`<img src="${u.photoUrl}" style="width:100%;height:100%;object-fit:cover"/>`:((line.name||'?')[0])}
            </div>
          </td>
          <td class="tc-name"><strong>${escHtml(line.name||'')}</strong>${editedBadge}${noteBadge}<div style="font-size:11px;color:var(--text-muted)">${escHtml(u?(u.title||ROLES[u.role]?.label||u.role||''):'')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></div></td>
          <td class="tc-detail" data-label="ID"><code>${u?(u.employeeId||'—'):'—'}</code></td>
          <td class="tc-detail" data-label="Department">${depts}</td>
          <td class="tc-detail" data-label="Base">₱${fmt(line.base)}</td>
          <td class="tc-detail" data-label="Allowance" style="color:var(--success)">+₱${fmt(line.allowance)}</td>
          <td class="tc-detail" data-label="Deductions" style="color:var(--danger)">-₱${fmt(line.otherDeductions)}</td>
          <td class="tc-detail" data-label="SSS" style="color:var(--danger)">-₱${fmt(line.sss)}</td>
          <td class="tc-detail" data-label="PhilHealth" style="color:var(--danger)">-₱${fmt(line.philhealth)}</td>
          <td class="tc-detail" data-label="Pag-IBIG" style="color:var(--danger)">-₱${fmt(line.pagibig)}</td>
          <td class="tc-detail" data-label="Tax" style="color:var(--danger)">-₱${fmt(line.tax)}</td>
          <td class="tc-detail" data-label="Cash Adv">${caCell}</td>
          <td class="tc-net"><strong style="color:${line.finalPay>=0?'var(--success)':'var(--danger)'}">₱${fmt(line.finalPay)}</strong></td>
          <td class="tc-actions">
            ${canAdjust?`<button class="btn-secondary btn-sm pr-adjust-btn" data-uid="${line.uid}" title="Adjust" aria-label="Adjust pay line">${emojiIcon('✎',16)}</button>`:''}
            ${canFinance?`<button class="btn-secondary btn-sm pr-note-btn" data-uid="${line.uid}" data-name="${escHtml(line.name||'')}" title="Note to employee" aria-label="Note to employee">${emojiIcon('📝',16)}</button>`:''}
            <button class="btn-secondary btn-sm print-slip-btn" data-uid="${line.uid}" title="Payslip" aria-label="Print payslip">${emojiIcon('🖨',16)}</button>
          </td>
        </tr>`;
      }).join('');

      // TOTALS — the same summary row the live preview has carried since the
      // owner asked for it ("maybe a row above shows the total"), now on the
      // FROZEN branch too. It only ever existed below, PAST the `return` that
      // ends this block, so the figure was visible while previewing and
      // VANISHED the moment Compute froze the run — i.e. exactly when he wants
      // to check it before Disburse. Summed from runData.lines and never
      // re-derived from today's roster: the frozen lines are what will actually
      // be disbursed (payroll recall spec §B3), so the total is of the money
      // that is really going out.
      if (runData.lines.length) {
        const _ft = runData.lines.reduce((a, l) => ({
          base:    a.base    + (l.base||0),
          allow:   a.allow   + (l.allowance||0),
          deduct:  a.deduct  + (l.otherDeductions||0),
          sss:     a.sss     + (l.sss||0),
          ph:      a.ph      + (l.philhealth||0),
          pagibig: a.pagibig + (l.pagibig||0),
          tax:     a.tax     + (l.tax||0),
          ca:      a.ca      + (l.caPlanned||0),
          net:     a.net     + (l.finalPay||0)
        }), { base:0, allow:0, deduct:0, sss:0, ph:0, pagibig:0, tax:0, ca:0, net:0 });
        // Excluded-staff wording, kept coherent with the live branch below. A
        // frozen run carries NO line for anyone computePayRun skipped, so the
        // only honest count on this branch is "roster members with no line in
        // THIS run" — which covers payrollExcluded staff and anyone hired since
        // the run was computed, without claiming to know which. The frozen
        // branch never listed those people as rows and still doesn't; this only
        // discloses that the total does not cover them.
        // Use the run's OWN record, not a roster proxy. computePayRun writes a
        // `skipped[]` of {uid,name,reason} onto pay_runs (js/departments.js) with
        // reasons 'removed' / 'production' / 'linked-worker-profile' /
        // 'excluded: <why>', and runData already holds it — no extra read, no
        // schema change. A roster proxy ("anyone with no line") over-counts,
        // because `employees` filters neither removed staff nor linked workers
        // while the engine skips both: the subtitle would jump from
        // "1 not on payroll" before Compute to "5 not in this run" after it,
        // silently changing meaning on the one screen whose job is to make the
        // figure checkable. Counting only the DELIBERATE exclusions keeps the
        // same semantics either side of the button.
        const _fSkipped  = Array.isArray(runData.skipped) ? runData.skipped : [];
        const _fNotInRun = _fSkipped.filter(s => String((s && s.reason) || '').startsWith('excluded')).length;
        const _fSkipNames = _fSkipped.filter(s => String((s && s.reason) || '').startsWith('excluded'))
                                     .map(s => (s && s.name) || (s && s.uid) || '').filter(Boolean).join(', ');
        tbody.innerHTML = `<tr class="pr-row pr-totals-row" style="background:var(--s1);font-weight:700">
          <td class="tc-avatar" style="text-align:center">${emojiIcon('sigma',16)}</td>
          <td class="tc-name"><strong>Total — ${runData.lines.length} staff</strong><div style="font-size:11px;color:var(--text-muted);font-weight:500">computed run — this is what disburses${_fNotInRun?` · <span title="${escHtml(_fSkipNames)}">${_fNotInRun} not on payroll</span>`:''}</div></td>
          <td class="tc-detail" data-label="ID">—</td>
          <td class="tc-detail" data-label="Department">—</td>
          <td class="tc-detail" data-label="Base">₱${fmt(_ft.base)}</td>
          <td class="tc-detail" data-label="Allowance" style="color:var(--success)">+₱${fmt(_ft.allow)}</td>
          <td class="tc-detail" data-label="Deductions" style="color:var(--danger)">-₱${fmt(_ft.deduct)}</td>
          <td class="tc-detail" data-label="SSS" style="color:var(--danger)">-₱${fmt(_ft.sss)}</td>
          <td class="tc-detail" data-label="PhilHealth" style="color:var(--danger)">-₱${fmt(_ft.ph)}</td>
          <td class="tc-detail" data-label="Pag-IBIG" style="color:var(--danger)">-₱${fmt(_ft.pagibig)}</td>
          <td class="tc-detail" data-label="Tax" style="color:var(--danger)">-₱${fmt(_ft.tax)}</td>
          <td class="tc-detail" data-label="Cash Adv" style="color:var(--danger)">${_ft.ca?`-₱${fmt(_ft.ca)}`:'—'}</td>
          <td class="tc-net"><strong style="color:${_ft.net>=0?'var(--success)':'var(--danger)'}">₱${fmt(_ft.net)}</strong></td>
          <td class="tc-actions"></td>
        </tr>` + tbody.innerHTML;
      }
      if (window.lucide) lucide.createIcons({ nodes: [tbody] });
      tbody.querySelectorAll('tr.pr-row').forEach(tr => {
        tr.addEventListener('click', (ev) => { if (ev.target.closest('button, a')) return; tr.classList.toggle('tc-expanded'); });
      });
      tbody.querySelectorAll('.pr-adjust-btn').forEach(btn => {
        btn.addEventListener('click', () => openAdjustModal(month, btn.dataset.uid));
      });
      // Note to employee — available regardless of state (computed/verified/
      // disbursing/disbursed); openEmployeeNoteModal itself decides which doc
      // is writable for the run's current state and blocks with a clear
      // message when neither is (the verified/disbursing window — see its
      // header comment and the pass report for the firestore.rules text that
      // would close that gap).
      tbody.querySelectorAll('.pr-note-btn').forEach(btn => {
        btn.addEventListener('click', () => openEmployeeNoteModal(month, btn.dataset.uid, btn.dataset.name));
      });
      return; // frozen-run mode — skip the live-preview branch below entirely
    }
    if (captionEl) captionEl.innerHTML = `Live preview from current pay settings — press <strong>Compute Payroll</strong> to freeze this month.`;

    // §A4 — statutory year keys off the MONTH BEING VIEWED, not "whatever
    // year it happens to be" (consistent with money-core.js's computePayLine
    // and the D10 disburse gate, which both already key off the run month).
    const statYear = /^\d{4}-\d{2}/.test(month) ? parseInt(month.slice(0,4),10) : (window.bizYear ? window.bizYear() : new Date().getFullYear());
    // LOCKSTEP with computePayRun's FULL skip chain (js/departments.js), not
    // just its payrollExcluded arm. If the preview shows someone Compute drops,
    // the roster contradicts the run — the same preview-vs-engine divergence the
    // statutory work had to close.
    //
    // 2026-08-08: this filter previously honoured payrollExcluded ONLY, while
    // the engine also skips `removed === true` (offboarded staff) and anyone
    // bridged to a weekly worker_profiles doc via linkedUid. Those two were
    // invisible until the frozen run grew a totals row of its own — now the two
    // totals sit either side of one button press, so three ex-employees still
    // carrying a salary would make the figure drop by their combined pay on
    // Compute with nothing on screen explaining it. The preview must skip
    // exactly what the engine skips.
    //
    // linkedUids mirrors js/departments.js's own construction (active profiles
    // with a linkedUid). Read through dbCachedGet so a roster re-render does not
    // re-fetch the collection; a failed read yields an EMPTY set, which is the
    // safe direction here — it shows a person the run might skip (visible, and
    // the frozen total then explains itself) rather than hiding someone who is
    // genuinely being paid.
    // ONE ROSTER — the same Set the outer scope built from a single
    // worker_profiles read (see `linkedUids` above). This closure used to
    // re-fetch the collection itself, so the banner's count and this exclusion
    // list could be computed from two different reads. `employees` is now
    // already filtered by that union, so the branch below is defensive only.
    const _linkedUids = linkedUids;

    // LOCKSTEP by construction: the reason comes from the engine's own
    // predicate (window.monthlyRunSkipReason), and only the wording is
    // localised for the screen. A new skip reason added to the engine can no
    // longer be missed here.
    // THIS MONTH's exclusions, straight off the run document already read above
    // — no extra fetch. Owner ruling 2026-08-10: an exclusion belongs to the
    // period, not the person, so the roster must be told WHICH period it is
    // showing. Passing nothing here would render everyone as payable and the
    // screen would disagree with the engine.
    const _periodExcluded = (runData && runData.excluded) || {};

    // ── ONE-TIME MIGRATION BANNER (owner ruling 2026-08-10, spec §2 option B+C) ──
    // The old payrollExcluded flag went live 2026-08-07 and carried no month, so
    // it meant "skip for ever". Under the new ruling it means nothing, and simply
    // ignoring it would put those people straight back into the next run — they
    // are the zero-salary staff whose −₱500.00 lines prompted the original
    // report, so that would book an expense and collect a cash advance from
    // someone who draws no pay.
    //
    // So: anyone still carrying the flag is NAMED here until a human resolves
    // them on this screen. Read-only and advisory — it changes no figure. It
    // disappears on its own once the last flag is cleared.
    const _legacyFlagged = employees.filter(e => e.payrollExcluded === true &&
                                                 !Object.prototype.hasOwnProperty.call(_periodExcluded, e.id));
    if (_legacyFlagged.length && captionEl) {
      const names = _legacyFlagged.map(e => escHtml(e.displayName || e.email || e.id)).join(', ');
      captionEl.innerHTML =
        `<span style="color:var(--warning)">${emojiIcon('⚠',13)} <strong>${_legacyFlagged.length}</strong> `
        + `${_legacyFlagged.length === 1 ? 'person was' : 'people were'} removed from payroll under the old rule, which had no month `
        + `and skipped them for ever: <strong>${names}</strong>. Removal now applies to ONE month only. `
        + `Remove them from <strong>${escHtml(month)}</strong> if they still should not be paid, or leave them to be paid this month.</span>`;
    }
    if (_runReadFailed && captionEl) {
      // Say it, rather than quietly showing everyone as payable. Compute itself
      // refuses outright on this (computePayRun), so the screen must not imply
      // the roster below it is complete.
      captionEl.innerHTML = `<span style="color:var(--warning)">${emojiIcon('⚠',13)} This month's payroll record could not be read, so anyone removed from THIS month may still be listed below. Reload before computing.</span>`;
    }
    const _skipReason = (u) => {
      const r = window.monthlyRunSkipReason(u, _linkedUids, _periodExcluded);
      if (!r) return null;
      if (r === 'removed') return 'offboarded';
      if (r === 'production' || r === 'linked-worker-profile') return 'paid weekly (Operations Team)';
      if (r.startsWith('excluded')) return 'not on payroll' + r.slice('excluded'.length);
      return r;
    };

    const _paidEmployees = employees.filter(u => !_skipReason(u));
    const _excluded      = employees.filter(u =>  _skipReason(u));

    const plans = await Promise.all(_paidEmployees.map(u => window.CashAdvance
      ? window.CashAdvance.planFor(u.id, month)
      : Promise.resolve({ caBalance:0, mode:'full', caPlanned:0, plan:[] })));
    _planByUser = {};
    _paidEmployees.forEach((u,i) => { _planByUser[u.id] = plans[i]; });

    // Running totals for the summary row (owner request: "show the current
    // total as well"). Accumulated from the SAME values each row renders, so
    // the total can never disagree with the column above it.
    const _tot = { base:0, allow:0, deduct:0, sss:0, ph:0, pagibig:0, tax:0, ca:0, net:0 };

    tbody.innerHTML = _paidEmployees.map(u => {
      const depts    = (Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—';
      const base     = u.salary||0;
      const allow    = u.allowance||0;
      const gross    = base + allow;
      // Hand-typed value wins; otherwise WS21's statutory table suggests the amount
      // (the "Auto-computed if 0" placeholder text is finally backed by real math).
      const sug      = window.computeStatutory ? window.computeStatutory({ grossPay: gross, year: statYear }) : null;
      // Statutory-config spec (2026-08-06) §4.3 — LOCKSTEP with the engine.
      // These four lines used to DUPLICATE money-core's `typed || table`
      // expression. The moment statConfig exists, a duplicated copy becomes a
      // preview that CONTRADICTS Compute (an 'exempt' employee showing a table
      // deduction here and zero after Compute). Both sides now call the ONE
      // resolver — window.resolveStatutoryEE (js/money-core.js) — so drift is
      // structurally impossible. With no statConfig the resolver reproduces the
      // old expression byte-for-byte, so every employee on record today renders
      // exactly as before.
      const _stat    = window.resolveStatutoryEE
        ? window.resolveStatutoryEE(u, sug)
        : { sss:        u.sss        || (sug ? sug.ee.sss : 0),
            philhealth: u.philhealth || (sug ? sug.ee.philhealth : 0),
            pagibig:    u.pagibig    || (sug ? sug.ee.pagibig : 0),
            tax:        u.tax        || (sug ? sug.ee.tax : 0) };
      const sss      = _stat.sss;
      const ph       = _stat.philhealth;
      const pagibig  = _stat.pagibig;
      const tax      = _stat.tax;
      const plan     = _planByUser[u.id] || { caBalance:0, mode:'full', caPlanned:0, plan:[] };
      const caBalance= plan.caBalance;
      const caAdv    = plan.caPlanned;
      const deduct   = (u.deductions||0) + sss + ph + pagibig + tax;
      const net      = gross - deduct - caAdv;
      _tot.base += base; _tot.allow += allow; _tot.deduct += (u.deductions||0);
      _tot.sss += sss; _tot.ph += ph; _tot.pagibig += pagibig; _tot.tax += tax;
      _tot.ca += caAdv; _tot.net += net;
      const modeTag  = { installment:'installment', 'custom-request':'custom', 'legacy-override':'custom', full:'full' }[plan.mode];
      const caCell   = caBalance > 0
        ? `<div style="color:var(--danger);white-space:nowrap">-₱${fmt(caAdv)}${modeTag?` <span style="font-size:10px;background:var(--primary-light);color:var(--on-primary);border-radius:4px;padding:1px 5px">${modeTag}</span>`:''}</div>
           <div style="font-size:10px;color:var(--text-muted)">bal ₱${fmt(caBalance)}</div>`
        : '<span style="color:var(--text-muted)">—</span>';
      // v14 Wave 4 Batch F4 — card reflow (≤700px, via the shared .table-cards
      // CSS pattern in styles.css). SAME <tr>/<td> markup at every width; only
      // the tc-* classes + data-label attrs change how CSS lays it out below
      // 700px. tc-avatar/tc-name/tc-net stay visible ("phone shows name/photo/
      // net prominent"); tc-detail cells are the tap-to-expand breakdown.
      return `<tr class="pr-row">
        <td class="tc-avatar" style="text-align:center">
          <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--on-primary);font-size:14px;margin:0 auto">
            ${u.photoUrl?`<img src="${u.photoUrl}" style="width:100%;height:100%;object-fit:cover"/>`:((u.displayName||'?')[0])}
          </div>
        </td>
        <td class="tc-name"><strong>${escHtml(u.displayName||u.email)}</strong><div style="font-size:11px;color:var(--text-muted)">${escHtml(u.title||ROLES[u.role]?.label||u.role)} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></div></td>
        <td class="tc-detail" data-label="ID"><code>${u.employeeId||'—'}</code></td>
        <td class="tc-detail" data-label="Department">${depts}</td>
        <td class="tc-detail" data-label="Base">₱${fmt(base)}</td>
        <td class="tc-detail" data-label="Allowance" style="color:var(--success)">+₱${fmt(allow)}</td>
        <td class="tc-detail" data-label="Deductions" style="color:var(--danger)">-₱${fmt(u.deductions||0)}</td>
        <td class="tc-detail" data-label="SSS" style="color:var(--danger)">-₱${fmt(sss)}</td>
        <td class="tc-detail" data-label="PhilHealth" style="color:var(--danger)">-₱${fmt(ph)}</td>
        <td class="tc-detail" data-label="Pag-IBIG" style="color:var(--danger)">-₱${fmt(pagibig)}</td>
        <td class="tc-detail" data-label="Tax" style="color:var(--danger)">-₱${fmt(tax)}</td>
        <td class="tc-detail" data-label="Cash Adv">${caCell}</td>
        <td class="tc-net"><strong style="color:${net>=0?'var(--success)':'var(--danger)'}">₱${fmt(net)}</strong></td>
        <td class="tc-actions">
          <button class="btn-secondary btn-sm ep-profile-btn" data-uid="${u.id}" data-name="${escHtml(u.displayName||u.email||'')}" title="Employee profile" aria-label="Employee profile">${emojiIcon('🪪',16)}</button>
          <button class="btn-secondary btn-sm edit-emp-pay-btn" data-uid="${u.id}" title="Edit" aria-label="Edit payroll">${emojiIcon('✎',16)}</button>
          ${canFinance ? `<button class="btn-secondary btn-sm raise-emp-btn" data-uid="${u.id}" title="Give raise" aria-label="Give raise">${emojiIcon('banknote',14)}</button>` : ''}
          ${canFinance ? `<button class="btn-secondary btn-sm pr-exclude-btn" data-uid="${u.id}" data-name="${escHtml(u.displayName||u.email||'')}" title="Not on payroll" aria-label="Remove from payroll">${emojiIcon('user-minus',14)}</button>` : ''}
          <button class="btn-secondary btn-sm print-slip-btn" data-uid="${u.id}" title="Payslip" aria-label="Print payslip">${emojiIcon('🖨',16)}</button>
        </td>
      </tr>`;
    }).join('');

    // TOTALS — rendered as the first row so the figure is visible without
    // scrolling a 10-person table (owner: "maybe a row above shows the total").
    // Summed from the very values the rows printed, so it cannot drift from
    // them, and it counts ONLY the people actually in the run.
    if (_paidEmployees.length) {
      const totalsRow = `<tr class="pr-row pr-totals-row" style="background:var(--s1);font-weight:700">
        <td class="tc-avatar" style="text-align:center">${emojiIcon('sigma',16)}</td>
        <td class="tc-name"><strong>Total — ${_paidEmployees.length} staff</strong><div style="font-size:11px;color:var(--text-muted);font-weight:500">this month's run${_excluded.length?` · ${_excluded.length} not on payroll`:''}</div></td>
        <td class="tc-detail" data-label="ID">—</td>
        <td class="tc-detail" data-label="Department">—</td>
        <td class="tc-detail" data-label="Base">₱${fmt(_tot.base)}</td>
        <td class="tc-detail" data-label="Allowance" style="color:var(--success)">+₱${fmt(_tot.allow)}</td>
        <td class="tc-detail" data-label="Deductions" style="color:var(--danger)">-₱${fmt(_tot.deduct)}</td>
        <td class="tc-detail" data-label="SSS" style="color:var(--danger)">-₱${fmt(_tot.sss)}</td>
        <td class="tc-detail" data-label="PhilHealth" style="color:var(--danger)">-₱${fmt(_tot.ph)}</td>
        <td class="tc-detail" data-label="Pag-IBIG" style="color:var(--danger)">-₱${fmt(_tot.pagibig)}</td>
        <td class="tc-detail" data-label="Tax" style="color:var(--danger)">-₱${fmt(_tot.tax)}</td>
        <td class="tc-detail" data-label="Cash Adv" style="color:var(--danger)">${_tot.ca?`-₱${fmt(_tot.ca)}`:'—'}</td>
        <td class="tc-net"><strong style="color:${_tot.net>=0?'var(--success)':'var(--danger)'}">₱${fmt(_tot.net)}</strong></td>
        <td class="tc-actions"></td>
      </tr>`;
      tbody.innerHTML = totalsRow + tbody.innerHTML;
    }

    // Skipped staff — shown, never silently dropped, each with the reason the
    // ENGINE would give. Three distinct reasons now land here, and they are not
    // interchangeable: only a deliberate payrollExcluded can be undone with
    // "put back on payroll". Offering that button to an offboarded person would
    // clear a flag that is not what is keeping them out (js/departments.js skips
    // on `removed` first), and offering it to a Type B worker would invite
    // double pay — the very thing the linked-worker skip exists to prevent.
    if (_excluded.length) {
      tbody.innerHTML += _excluded.map(u => {
        const _r      = _skipReason(u) || '';
        const _isExcl = _r.startsWith('not on payroll');
        const _note   = _isExcl
          ? 'Excluded from this and every run until put back on payroll.'
          : (u.removed === true
              ? 'Offboarded — reinstate from Team before they can be paid.'
              : 'Paid weekly under Operations Team — kept out of the monthly run so nobody is paid twice.');
        return `<tr class="pr-row pr-excluded-row" style="opacity:.6">
        <td class="tc-avatar" style="text-align:center">${emojiIcon('user-minus',16)}</td>
        <td class="tc-name"><strong style="text-decoration:line-through">${escHtml(u.displayName||u.email)}</strong>
          <div style="font-size:11px;color:var(--text-muted)">${escHtml(_r.charAt(0).toUpperCase() + _r.slice(1))}</div></td>
        <td class="tc-detail" data-label="ID"><code>${escHtml(u.employeeId||'—')}</code></td>
        <td class="tc-detail" data-label="Department" colspan="9" style="color:var(--text-muted)">${_note}</td>
        <td class="tc-net"><span style="color:var(--text-muted)">—</span></td>
        <td class="tc-actions">${(canFinance && _isExcl)?`<button class="btn-secondary btn-sm pr-include-btn" data-uid="${u.id}" data-name="${escHtml(u.displayName||u.email||'')}" title="Put back on payroll" aria-label="Put back on payroll">${emojiIcon('user-plus',14)}</button>`:''}</td>
      </tr>`;
      }).join('');
    }
    if (window.lucide) lucide.createIcons({ nodes: [tbody] });

    // Card view (≤700px): tap the row (outside the action buttons) to reveal
    // the full breakdown — toggles a class only, never touches the cell
    // markup/values (see the .table-cards comment in styles.css). No-op at
    // desktop widths since .tc-detail is only ever hidden inside that
    // max-width:700px query.
    tbody.querySelectorAll('tr.pr-row').forEach(tr => {
      tr.addEventListener('click', (ev) => {
        if (ev.target.closest('button, a')) return;
        tr.classList.toggle('tc-expanded');
      });
    });

    // ── Not on payroll / put back on payroll ──────────────────────────────
    // Writes payrollExcluded + the reason onto payroll/{uid} (money-admin
    // gated by firestore.rules, same doc the pay figures live in — the users
    // doc is world-readable and must never carry this). computePayRun reads
    // the same flag, so the roster and the run can never disagree.
    // The in-memory row is patched alongside the write for the same reason the
    // statutory work had to: `employees` is captured once and re-rendered from
    // memory, so without this the roster would show the OLD state until the
    // next navigation while Compute used the new one.
    // ── PERIOD-SCOPED, owner ruling 2026-08-10 ────────────────────────────
    // "removing of certain members on payroll is strictly applied on that
    // payroll period only unless said member is removed from system."
    //
    // Writes to pay_runs/{month}.excluded — THIS MONTH's own map — not to
    // payroll/{uid}. The old flag carried no month, so one removal skipped the
    // person in every later run: no payslip, no salary history, no ledger
    // entry, their cash advance stopped being collected, and they fell out of
    // the BIR alphalist, all with no signal anywhere.
    //
    // set({merge:true}) rather than update(): the run document does not exist
    // for a month nobody has computed yet, and removing someone from an
    // uncomputed month is the normal case. firestore.rules carries a matching
    // clause fenced to these three keys with the state frozen (2026-08-10) —
    // without it the state-transition rule would have denied this write on a
    // draft month.
    const _setPayrollExcluded = async (uid, excluded, reason) => {
      const F = firebase.firestore.FieldValue;
      await db.collection('pay_runs').doc(month).set({
        excluded: { [uid]: excluded ? (reason || true) : F.delete() },
        excludedUpdatedAt: F.serverTimestamp(),
        excludedUpdatedBy: (currentUser && currentUser.uid) || ''
      }, { merge: true });
      // No in-memory patch: both callers follow this with loadPayrollTable(month),
      // which re-reads pay_runs/{month} itself. A second copy of the same fact
      // could only ever drift from the first.
      window.logAudit && window.logAudit('update', 'pay_run_exclusion', month,
        { uid, excluded, reason: reason || '', period: month });
    };
    tbody.querySelectorAll('.pr-exclude-btn').forEach(btn => {
      btn.addEventListener('click', () => window.busy(btn, async () => {
        const name = btn.dataset.name || 'this person';
        const reason = await window.promptDialog({
          title: 'Not on payroll',
          message: `Why is ${name} not drawing a payroll? This is recorded on the run so every month accounts for them.`,
          placeholder: 'e.g. owner / not yet regularised / paid outside payroll',
          confirmLabel: 'Remove from payroll',
          required: true          // no blank reasons — the point is the record
        });
        if (reason === null) return;                       // cancelled
        if (!String(reason).trim()) { Notifs.showToast('A reason is required.', 'error'); return; }
        await _setPayrollExcluded(btn.dataset.uid, true, String(reason).trim());
        Notifs.showToast(`${name} removed from payroll.`, 'success');
        loadPayrollTable(month);
      }));
    });
    tbody.querySelectorAll('.pr-include-btn').forEach(btn => {
      btn.addEventListener('click', () => window.busy(btn, async () => {
        const name = btn.dataset.name || 'this person';
        if (!await confirmDialog({ message: `Put ${name} back on payroll? They will be included from the next Compute.` })) return;
        await _setPayrollExcluded(btn.dataset.uid, false);
        Notifs.showToast(`${name} is back on payroll.`, 'success');
        loadPayrollTable(month);
      }));
    });

    tbody.querySelectorAll('.raise-emp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const emp = employees.find(u=>u.id===btn.dataset.uid);
        if (!emp) return;
        openSalaryRaiseModal({
          subjectType: 'payroll',
          subjectId:   emp.id,
          subjectName: emp.displayName || emp.email,
          fieldLabel:  'Base Salary',
          targetField: 'salary',
          current:     emp.salary || 0
        }, currentUser, () => loadPayrollTable(month));
      });
    });

    // HR employee profile — the composed per-person view (employment date,
    // status, job, gov IDs, rate, CA, raises, pay history).
    tbody.querySelectorAll('.ep-profile-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.openEmployeeProfile) window.openEmployeeProfile({ uid: btn.dataset.uid, name: btn.dataset.name });
      });
    });

    tbody.querySelectorAll('.edit-emp-pay-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid  = btn.dataset.uid;
        const emp  = employees.find(u=>u.id===uid);
        const plan = _planByUser[uid] || { caBalance:0, mode:'full', caPlanned:0, plan:[] };
        const caBalance = plan.caBalance;
        if (!emp) return;

        // §A4 — same run-month-keyed statutory year as loadPayrollTable's preview above.
        const statYear = /^\d{4}-\d{2}/.test(month) ? parseInt(month.slice(0,4),10) : (window.bizYear ? window.bizYear() : new Date().getFullYear());
        const sug = window.computeStatutory ? window.computeStatutory({ grossPay: (emp.salary||0)+(emp.allowance||0), year: statYear }) : null;
        const unverifiedBadge = sug && sug.unverified ? ` <span style="font-size:10px;color:var(--warning)">${emojiIcon('⚠',10)} unverified rates</span>` : '';
        const inst = plan.plan[0]; // first CA in the plan, for the "installment N of M" label
        const _payClass = emp.payClass==='production' ? 'production' : 'regular';
        // Statutory-config spec §4.1 — the currently-saved mode per contribution
        // type. Anything that is not one of the three real modes (an absent
        // statConfig, an absent key, or garbage) reads as 'default', which is
        // exactly how window.resolveStatutoryEE treats it: today's legacy
        // "typed amount wins, else the table" behaviour.
        const _scOf = (k) => (emp.statConfig && ['auto','fixed','exempt'].includes(emp.statConfig[k])) ? emp.statConfig[k] : 'default';

        // ── WINDOW FIRST, DATA SECOND (v14.0.71) ──────────────────────────
        // Two Firestore round-trips (the KPI batch, then the linked
        // worker_profiles lookup) used to run BEFORE openPage, so tapping ✎
        // Edit on a roster row changed nothing on screen until both landed.
        // The panel is pushed synchronously here with a skeleton body instead.
        //
        // The `if (!emp) return` guard above deliberately STAYS ahead of this
        // call: it is an in-memory lookup against the roster already on
        // screen, costs nothing, and a window that has to be yanked away is
        // worse than a slow one.
        //
        // Title depends only on `emp` (already in hand), so it is final at
        // open time. Save ships DISABLED — it cannot act on a form that isn't
        // there yet — and is enabled the line after the real markup lands, so
        // the settled DOM is byte-identical to what this screen always
        // rendered. Cancel is inline onclick="closeModal()" and is live
        // immediately, so the user is never trapped on a loading panel.
        const panel = openPage(`Edit Payroll — ${escHtml(emp.displayName||'')}`,
          window.skeletonHtml('rows', 6),
          `<button class="btn-primary" id="save-ep-btn" disabled>Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
        const bodyEl = panel.querySelector('.page-panel-body');

        // Hand-rolled rather than withLoadingAndError: the ~70 lines of
        // cash-advance and payroll-save wiring below have to run AFTER the
        // fill, and moving them into a renderer callback would re-indent every
        // one of them (see _hrPanelError's header). Same lifecycle, same error
        // block, no reflow of money-writing code.
        let _kpiReads, linkedWpSnap;
        try {
          // ── KPI computation (owner feature — read-only section below).
          // Reuses money-core.js's window.computeKpiForMonth + dashboards.js's
          // window.getAttendanceScore(uid, month) — the EXACT same
          // functions/inputs computePayRun (departments.js) feeds into
          // computePayLine, so the number shown here always matches what an
          // actual Compute Payroll run would use for this uid/month. Never
          // writes anything; never changes payroll/{uid} or any pay math.
          _kpiReads = await Promise.all([
            // Same dual-shape assignedTo filter as computePayRun (departments.js) —
            // deliberately NOT getKpiScore's array-contains query (dashboards.js),
            // which misses a scalar (non-array) assignedTo value.
            db.collection('tasks').get().catch(()=>({docs:[]})),
            db.collection('kpi_targets').doc(uid).get().catch(()=>null),
            window.getAttendanceScore ? window.getAttendanceScore(uid, month) : Promise.resolve(1)
          ]);
          // ── Existing cash advance (owner feature — read-only section below).
          // Type-A (this uid's own cash_advances docs) is already `plan`/
          // `caBalance` above (window.CashAdvance.planFor). Type-B tracks CA on
          // a linked worker_profiles doc's OWN caBalance field instead — an
          // entirely separate ledger from the cash_advances collection (hr.js's
          // Worker Payslip generator, openPayslipGenerator's deductWorker, is
          // the only writer of worker_profiles.caBalance). A worker_profiles
          // doc can point linkedUid at this uid even while payClass here is
          // still 'regular' (computePayRun treats "linked" and "payClass:
          // production" as two independent skip reasons — see its
          // `linkedUids` set), so this is checked unconditionally, not only
          // when _payClass above is 'production'.
          linkedWpSnap = await db.collection('worker_profiles').where('linkedUid','==',uid).limit(1).get().catch(()=>({docs:[]}));
        } catch (err) {
          // FAILURE PATH. Only window.getAttendanceScore can actually reject
          // here (every other read carries its own .catch), and before this
          // pass that rejection meant the tap did nothing at all — no window,
          // no message, an unhandled rejection in the console. Now it lands as
          // a visible error inside the window the tap already opened, never an
          // eternal skeleton.
          if (panel.isConnected) _hrPanelError(bodyEl, err);
          return;
        }
        // CLOSED MID-FLIGHT — Back can be pressed before either read lands.
        if (!panel.isConnected) return;
        const [kpiTasksSnap, kpiTargetSnap, attScore] = _kpiReads;
        const kpiUserTasks = kpiTasksSnap.docs.map(d=>d.data())
          .filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(uid) : t.assignedTo === uid);
        const kpiDeliverableRaw = (kpiTargetSnap && kpiTargetSnap.exists) ? kpiTargetSnap.data().deliverableScore : undefined;
        const kpiScore = window.computeKpiForMonth
          ? window.computeKpiForMonth(kpiUserTasks, month, kpiDeliverableRaw, window.taskDoneMonth, window.taskCreatedMonth)
          : 1;
        const { doneInM, inScopeCount } = _kpiMonthBreakdown(kpiUserTasks, month);
        const taskPct = inScopeCount > 0 ? Math.round(doneInM/inScopeCount*100) : 100; // D2 floor — no in-scope work ≠ bad KPI
        const attScoreNum = typeof attScore === 'number' ? attScore : 1;
        const perfFactor = Math.min(1, Math.max(0, kpiScore*0.7 + attScoreNum*0.3)); // same formula as computePayLine
        // No pay_runs doc has been Computed for THIS month in this branch
        // (that's exactly when the frozen-run early-return at the top of
        // loadPayrollTable takes over instead), so there is no committed
        // payPolicy yet — `runData` (already read once at the top of
        // loadPayrollTable, in closure here) is the best available signal
        // of which policy would apply if Compute ran right now.
        const payPolicyNow = (runData && runData.payPolicy) ? runData.payPolicy : 'flat';
        const linkedWp = linkedWpSnap.docs.length ? { id: linkedWpSnap.docs[0].id, ...linkedWpSnap.docs[0].data() } : null;

        // The markup below is byte-for-byte what openPage used to be handed —
        // only WHEN it reaches the panel has changed.
        bodyEl.innerHTML = `
          <div class="form-group"><label>Employee Type</label>
            <select id="ep-class" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
              <option value="regular" ${_payClass==='regular'?'selected':''}>Office Team — monthly (KPI + attendance)</option>
              <option value="production" ${_payClass==='production'?'selected':''}>Operations Team — weekly (hourly attendance, 8-hr day)</option>
            </select>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Office Team staff are paid monthly here. Operations Team workers are paid weekly on the Operations Team tab, excluded from this monthly run, and — if their Worker Profile's "Linked Login Account" is set to this uid (Payroll → Operations Team → the profile's edit form) — can self-service Time In/Out with geofencing from their own phone (HR → Work Sites).</div>
          </div>
          <div style="margin-top:4px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface2,var(--surface))">
            <label style="font-weight:600">${emojiIcon('bar-chart-2',16)} KPI Computation — ${window.fmtMonthLabel ? window.fmtMonthLabel(month) : month}</label>
            <div style="font-size:11px;color:var(--text-muted);margin:4px 0 8px">Read-only — shown for reference, never edits pay. ${payPolicyNow==='performance'
              ? `This month's pay policy is <strong>Performance</strong>: the perfFactor below <em>scales the allowance</em> (base wage is never docked).`
              : `This month's pay policy is <strong>Flat</strong> (the default): KPI and attendance are informational only here — they do <strong>not</strong> change this employee's pay unless a Compute Payroll run is switched to the Performance policy.`}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;font-size:12px">
              <div>Task completion: <strong>${doneInM} of ${inScopeCount}</strong> in-scope task${inScopeCount===1?'':'s'} done${inScopeCount>0?` <span style="color:var(--text-muted)">(${taskPct}%)</span>`:` <span style="color:var(--text-muted)">(no in-scope tasks — floors at 100%)</span>`}</div>
              <div>Deliverable score: <strong>${typeof kpiDeliverableRaw==='number' ? kpiDeliverableRaw+'/100' : 'not set'}</strong>${typeof kpiDeliverableRaw!=='number'?' <span style="color:var(--text-muted)">(defaults to 100%)</span>':''}</div>
              <div>Attendance score: <strong>${Math.round(attScoreNum*100)}%</strong></div>
              <div>KPI score (70% task + 30% deliverable): <strong>${Math.round(kpiScore*100)}%</strong></div>
            </div>
            <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);font-size:12px">perfFactor = 0.7×KPI + 0.3×attendance = <strong>${(perfFactor*100).toFixed(1)}%</strong></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>${_payClass==='production'?'Weekly Rate':'Base Salary'}</label>
              <div style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2,var(--surface));color:var(--text-muted)">
                ₱${fmt(emp.salary||0)} · <span style="font-size:11px">change via ${emojiIcon('💸',16)} Give Raise (approval-routed)</span>
              </div>
            </div>
            <div class="form-group"><label>Allowance</label><input id="ep-allow" type="number" value="${emp.allowance||0}" inputmode="decimal"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Other Deductions</label><input id="ep-deduct" type="number" value="${emp.deductions||0}" inputmode="decimal"/></div>
            <div class="form-group"><label>… of which unearned pay</label><input id="ep-deduct-unearned" type="number" value="${emp.deductionsUnearned||0}" inputmode="decimal"/></div>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin:-4px 0 10px">
            Take-home is the same either way — this only decides how the deduction is booked.
            Leave <strong>unearned</strong> at ₱0 for money you withhold and owe onward (cash bond,
            canteen, uniform, a staff loan): the full pay stays a company expense and the withheld
            amount is booked as <em>Employee Deductions Payable</em> until you hand it over.
            Put the amount here instead for pay that was never earned (absence, tardiness, a
            penalty): that is not withheld money, so it comes out of payroll expense entirely and
            nothing is owed. Split it if the month has both.
          </div>
          <div class="form-row">
            <div class="form-group"><label>SSS${unverifiedBadge}</label>
              <div style="display:flex;gap:6px">
                <select id="ep-sss-mode" style="flex:none;width:112px;padding:8px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">
                  <option value="default" ${_scOf('sss')==='default'?'selected':''}>Default</option>
                  <option value="auto"    ${_scOf('sss')==='auto'?'selected':''}>Auto (table)</option>
                  <option value="fixed"   ${_scOf('sss')==='fixed'?'selected':''}>Fixed ₱</option>
                  <option value="exempt"  ${_scOf('sss')==='exempt'?'selected':''}>Exempt</option>
                </select>
                <input id="ep-sss" type="number" value="${emp.sss||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.sss):'0.00'}" inputmode="decimal" style="flex:1"/>
              </div>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>PhilHealth</label>
              <div style="display:flex;gap:6px">
                <select id="ep-ph-mode" style="flex:none;width:112px;padding:8px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">
                  <option value="default" ${_scOf('philhealth')==='default'?'selected':''}>Default</option>
                  <option value="auto"    ${_scOf('philhealth')==='auto'?'selected':''}>Auto (table)</option>
                  <option value="fixed"   ${_scOf('philhealth')==='fixed'?'selected':''}>Fixed ₱</option>
                  <option value="exempt"  ${_scOf('philhealth')==='exempt'?'selected':''}>Exempt</option>
                </select>
                <input id="ep-ph" type="number" value="${emp.philhealth||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.philhealth):'0.00'}" inputmode="decimal" style="flex:1"/>
              </div>
            </div>
            <div class="form-group"><label>Pag-IBIG</label>
              <div style="display:flex;gap:6px">
                <select id="ep-pi-mode" style="flex:none;width:112px;padding:8px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">
                  <option value="default" ${_scOf('pagibig')==='default'?'selected':''}>Default</option>
                  <option value="auto"    ${_scOf('pagibig')==='auto'?'selected':''}>Auto (table)</option>
                  <option value="fixed"   ${_scOf('pagibig')==='fixed'?'selected':''}>Fixed ₱</option>
                  <option value="exempt"  ${_scOf('pagibig')==='exempt'?'selected':''}>Exempt</option>
                </select>
                <input id="ep-pi" type="number" value="${emp.pagibig||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.pagibig):'0.00'}" inputmode="decimal" style="flex:1"/>
              </div>
            </div>
          </div>
          <div class="form-group"><label>Tax</label>
            <div style="display:flex;gap:6px">
              <select id="ep-tax-mode" style="flex:none;width:112px;padding:8px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">
                <option value="default" ${_scOf('tax')==='default'?'selected':''}>Default</option>
                <option value="auto"    ${_scOf('tax')==='auto'?'selected':''}>Auto (table)</option>
                <option value="fixed"   ${_scOf('tax')==='fixed'?'selected':''}>Fixed ₱</option>
                <option value="exempt"  ${_scOf('tax')==='exempt'?'selected':''}>Exempt</option>
              </select>
              <input id="ep-tax" type="number" value="${emp.tax||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.tax):'0.00'}" inputmode="decimal" style="flex:1"/>
            </div>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
            <strong>Default</strong> = a typed amount wins; a typed ₱0 falls back to the table (old behaviour).
            <strong>Auto</strong> = always the table amount for the run month.
            <strong>Fixed</strong> = always the typed amount, even ₱0.
            <strong>Exempt</strong> = do not deduct — the employer share for that item is dropped too, and the
            employee is left off that agency's remittance.
          </div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <label style="font-weight:600">${emojiIcon('🪪',16)} Statutory IDs <span style="font-size:11px;color:var(--text-muted)">(required for Alphalist / BIR 2316)</span></label>
            <div class="form-row">
              <div class="form-group"><label>TIN</label><input id="ep-tin" value="${escHtml(emp.tinNum||'')}" placeholder="000-000-000-000"/></div>
              <div class="form-group"><label>SSS No.</label><input id="ep-ssnum" value="${escHtml(emp.ssNum||'')}" placeholder="00-0000000-0"/></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>PhilHealth No.</label><input id="ep-phnum" value="${escHtml(emp.phNum||'')}"/></div>
              <div class="form-group"><label>Pag-IBIG MID</label><input id="ep-pagnum" value="${escHtml(emp.pagibigNum||'')}"/></div>
            </div>
          </div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <label style="font-weight:600">${emojiIcon('💳',16)} Existing Cash Advance</label>
            <div style="font-size:11px;color:var(--text-muted);margin:4px 0 8px">Read-only — current outstanding balance(s) on record. Choosing how much to deduct FROM this payroll run (if any) is the actionable section below.</div>
            <div style="font-size:12px;display:flex;flex-direction:column;gap:4px">
              <div>Office Team — Payroll Cash Advance <span style="color:var(--text-muted)">(installment plan)</span>: <strong>${caBalance>0?'₱'+fmt(caBalance):'—'}</strong></div>
              ${linkedWp ? `<div>Operations Team — Worker Profile CA balance <span style="color:var(--text-muted)">(linked profile: ${escHtml(linkedWp.name||linkedWp.id)})</span>: <strong>₱${fmt(linkedWp.caBalance||0)}</strong></div>` : ''}
            </div>
          </div>
          ${caBalance > 0 ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <label style="font-weight:600">${emojiIcon('💳',16)} Cash Advance — Outstanding ₱${fmt(caBalance)}${inst?` · Installment ${inst.installmentNo} of ${inst.terms}`:''}</label>
            <!-- Repayment-mode radio group. This block is NOT inside a .form-group,
                 so the css/styles.css .form-group input {width:100%;-webkit-appearance:none}
                 rule (and its 2026-08-10 checkbox/radio carve-out) never reached it —
                 the radios always rendered as native dots with a visible selected
                 state. Shared name="ep-ca-mode" groups them; installment is checked
                 whenever mode isn't 'full', so exactly one is always pre-selected and
                 nobody can be looking at a group with no visible answer.
                 label.check-row (css/styles.css ~385) is the house 44px tap-target
                 wrap — added here because a 13px radio is not a phone-sized target on
                 a control that decides how much of a cash advance comes out of this
                 pay run. padding overridden to 4px 0 so the dots stay flush with the
                 section heading instead of indenting 8px. -->
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
              <label class="check-row" style="font-size:13px;padding:4px 0">
                <input type="radio" name="ep-ca-mode" value="installment" ${plan.mode!=='full'?'checked':''}/>
                This month's installment — ₱${fmt(plan.caPlanned)}
              </label>
              <label class="check-row" style="font-size:13px;padding:4px 0">
                <input type="radio" name="ep-ca-mode" value="full" ${plan.mode==='full'?'checked':''}/>
                Pay off full balance — ₱${fmt(caBalance)}
              </label>
              <label class="check-row" style="font-size:13px;padding:4px 0">
                <input type="radio" name="ep-ca-mode" value="custom"/>
                Custom amount
                <input id="ep-ca-custom" type="number" min="0" max="${caBalance}" step="0.01" style="width:120px;margin-left:4px" placeholder="0.00"/>
              </label>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Remaining after this payroll: ₱<span id="ep-ca-remaining">${fmt(Math.max(0,caBalance-plan.caPlanned))}</span></div>
          </div>` : ''}
        `;
        // Save is live only now that the form it saves actually exists;
        // removeAttribute leaves exactly `<button class="btn-primary"
        // id="save-ep-btn">Save</button>`, the markup this footer always had.
        panel.querySelector('#save-ep-btn')?.removeAttribute('disabled');
        // Icons in the markup just injected — emojiIcon() emits
        // `<i data-lucide>`, and openPage's own sweep ran back when the body
        // was still a skeleton, so the KPI / gov-ID / cash-advance glyphs
        // would otherwise stay blank gaps.
        if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });

        // Statutory-config spec §4.1 — the amount input is INERT under 'auto'
        // (the table always wins) and 'exempt' (always 0), so grey it out
        // instead of letting HR type a number that silently does nothing.
        // Under 'default'/'fixed' it stays fully editable, exactly as today.
        // Display only — it never changes what is written (a disabled input
        // still exposes .value to the save handler below).
        const _epStatPairs = [['ep-sss-mode','ep-sss'],['ep-ph-mode','ep-ph'],['ep-pi-mode','ep-pi'],['ep-tax-mode','ep-tax']];
        const _epSyncStatInputs = () => {
          _epStatPairs.forEach(([modeId, inputId]) => {
            const sel = panel.querySelector('#'+modeId), inp = panel.querySelector('#'+inputId);
            if (!sel || !inp) return;
            const inert = (sel.value === 'auto' || sel.value === 'exempt');
            inp.disabled = inert;
            inp.style.opacity = inert ? '0.55' : '';
            inp.title = sel.value === 'exempt' ? 'Exempt — not deducted; this amount is ignored'
                      : sel.value === 'auto'   ? 'Auto — the statutory table amount is used; this amount is ignored'
                      : '';
          });
        };
        _epStatPairs.forEach(([modeId]) => panel.querySelector('#'+modeId)?.addEventListener('change', _epSyncStatInputs));
        _epSyncStatInputs();

        // ── LISTENERS AFTER THE FILL ──────────────────────────────────────
        // Everything from here down is unchanged; it simply runs one await
        // later than it used to. Wiring it any earlier would bind nothing,
        // because none of these ids existed until the assignment above.
        if (caBalance > 0) {
          const updateRemaining = () => {
            const mode   = panel.querySelector('input[name="ep-ca-mode"]:checked')?.value || 'installment';
            const custom = parseFloat(panel.querySelector('#ep-ca-custom')?.value)||0;
            const amt    = mode==='full' ? caBalance : mode==='custom' ? Math.min(custom, caBalance) : plan.caPlanned;
            panel.querySelector('#ep-ca-remaining').textContent = fmt(Math.max(0, caBalance-amt));
          };
          panel.querySelectorAll('input[name="ep-ca-mode"]').forEach(r=>r.addEventListener('change', updateRemaining));
          panel.querySelector('#ep-ca-custom')?.addEventListener('input', () => {
            const radio = panel.querySelector('input[name="ep-ca-mode"][value="custom"]');
            if (radio) radio.checked = true;
            updateRemaining();
          });
        }

        // SCOPED TO THIS PANEL — the enable above already used
        // panel.querySelector while the bind and every field read below used
        // document.getElementById. That is the identical enable-scoped /
        // bind-global split that produced "Create task not working": open ✎ Edit
        // Payroll on one employee, Back, open it on the next within openPage's
        // 300ms removal window, and the handler attaches to the DYING panel while
        // the visible Save is enabled and dead. On this form that means HR edits
        // allowance / deductions / SSS / PhilHealth / Pag-IBIG / tax, taps Save,
        // sees no toast and no error, and the next Compute runs on the OLD
        // numbers — the correction silently lost. The field reads are scoped too:
        // a global read would have pulled the dying panel's values.
        panel.querySelector('#save-ep-btn').addEventListener('click', () => window.busy(panel.querySelector('#save-ep-btn'), async () => {
          // All pay — base, allowance, and government deductions — lives in the
          // protected payroll/{uid} doc (finance/admin write), not the users doc.
          // v12 WS23 — base salary is NOT writable here (approval-routed via 💸
          // Give Raise instead); this modal only edits allowance/deductions/statutory.
          await db.collection('payroll').doc(uid).set({
            payClass:   panel.querySelector('#ep-class')?.value === 'production' ? 'production' : 'regular',
            allowance:  parseFloat(panel.querySelector('#ep-allow').value)||0,
            deductions: parseFloat(panel.querySelector('#ep-deduct').value)||0,
            // How much of `deductions` is pay never earned (absence/tardiness/
            // penalty) rather than money withheld and owed onward. Clamped into
            // [0, deductions] here as well as in money-core, so a stale value
            // left behind after the total is lowered can never exceed it.
            deductionsUnearned: Math.min(
              Math.max(parseFloat(panel.querySelector('#ep-deduct-unearned')?.value)||0, 0),
              parseFloat(panel.querySelector('#ep-deduct').value)||0
            ),
            sss:        parseFloat(panel.querySelector('#ep-sss').value)||0,
            philhealth: parseFloat(panel.querySelector('#ep-ph').value)||0,
            pagibig:    parseFloat(panel.querySelector('#ep-pi').value)||0,
            tax:        parseFloat(panel.querySelector('#ep-tax').value)||0,
            // Statutory-config spec §4.2 — MODE only; the amounts stay in the
            // four flat fields above (one source of truth per amount).
            // 'default' MUST mean the key is ABSENT, so the resolver runs its
            // legacy branch rather than seeing a stale mode string — hence
            // FieldValue.delete() inside the merged map. Four deletes leave an
            // empty map, which the resolver treats exactly like an absent one.
            statConfig: (() => {
              const m = {};
              [['sss','ep-sss-mode'],['philhealth','ep-ph-mode'],['pagibig','ep-pi-mode'],['tax','ep-tax-mode']]
                .forEach(([k, elId]) => {
                  const v = panel.querySelector('#'+elId)?.value;
                  m[k] = (v === 'auto' || v === 'fixed' || v === 'exempt')
                    ? v : firebase.firestore.FieldValue.delete();
                });
              return m;
            })(),
            // v12 WS39 — statutory IDs (alphalist/2316 prerequisite). Free-text,
            // same field names as worker_profiles so toPayslipModel reads one
            // vocabulary across both payroll cycles.
            tinNum:     panel.querySelector('#ep-tin')?.value.trim()   || '',
            ssNum:      panel.querySelector('#ep-ssnum')?.value.trim() || '',
            phNum:      panel.querySelector('#ep-phnum')?.value.trim() || '',
            pagibigNum: panel.querySelector('#ep-pagnum')?.value.trim()|| '',
          }, {merge:true});
          if (emp) emp.payClass = panel.querySelector('#ep-class')?.value === 'production' ? 'production' : 'regular';
          window.logAudit && window.logAudit('update','payroll',uid,{ allowance:parseFloat(panel.querySelector('#ep-allow').value)||0 });

          // Statutory-config spec §4.2 — the modes actually chosen, read back
          // from the same selects the write above used.
          const _epModeOf = (elId) => { const v = panel.querySelector('#'+elId)?.value; return (v==='auto'||v==='fixed'||v==='exempt') ? v : 'default'; };
          const _epModes  = { sss:_epModeOf('ep-sss-mode'), philhealth:_epModeOf('ep-ph-mode'), pagibig:_epModeOf('ep-pi-mode'), tax:_epModeOf('ep-tax-mode') };

          // Override tracking (v12 WS21 decision 4) — flag divergence from the
          // computed suggestion for later audit review; never blocks the save.
          if (sug) {
            [['sss',sug.ee.sss,'ep-sss'],['philhealth',sug.ee.philhealth,'ep-ph'],['pagibig',sug.ee.pagibig,'ep-pi'],['tax',sug.ee.tax,'ep-tax']]
              .forEach(([field, computed, elId]) => {
                // Statutory-config spec §4.2 — under auto/exempt the typed amount
                // is inert (nothing reads it), so "divergence" from the table is
                // noise, not an override worth auditing.
                if (_epModes[field] === 'auto' || _epModes[field] === 'exempt') return;
                const typed = parseFloat(panel.querySelector('#'+elId).value)||0;
                if (typed && Math.abs(typed-computed) > 0.01) {
                  window.logAudit && window.logAudit('statutory-override','payroll',uid,{ field, computed, entered: typed });
                }
              });
          }

          // Statutory-config spec §4.2 — one audit row when the MODES changed
          // (who/when; the WHY for an exemption stays with the accountant, §10.4).
          {
            const _before = emp.statConfig || {};
            const _after  = {};
            Object.keys(_epModes).forEach(k => { if (_epModes[k] !== 'default') _after[k] = _epModes[k]; });
            const _norm = (o) => ['sss','philhealth','pagibig','tax'].map(k => `${k}:${o[k]||'default'}`).join(',');
            if (_norm(_before) !== _norm(_after)) {
              window.logAudit && window.logAudit('statutory-config','payroll',uid,{ before:_before, after:_after });
            }
            // D6 — keep the in-memory roster row honest. loadPayrollTable(month)
            // at the bottom of this handler re-renders the roster from the SAME
            // `employees` array captured once at the top of
            // renderPayrollManagement — it does NOT re-read the payroll docs.
            // Patching only statConfig therefore paired a NEW mode with a STALE
            // amount: "SSS = Fixed ₱500" saved against emp.sss still 0 made the
            // resolver return 0, so the roster showed −₱0.00 (and a net ₱500 too
            // high) while the very next Compute deducted ₱500. Display-only and
            // self-healing on navigation, but it broke the same-screen
            // before/after check the rollout plan (spec §7) tells the owner to
            // verify every flip with. Patch every statutory amount this handler
            // just wrote, alongside the mode.
            if (emp) {
              emp.statConfig = _after;
              emp.sss        = parseFloat(panel.querySelector('#ep-sss').value)||0;
              emp.philhealth = parseFloat(panel.querySelector('#ep-ph').value)||0;
              emp.pagibig    = parseFloat(panel.querySelector('#ep-pi').value)||0;
              emp.tax        = parseFloat(panel.querySelector('#ep-tax').value)||0;
              // …and the other two pay fields this same handler writes above
              // (allowance/deductions). Pre-existing staleness, but leaving them
              // out made the patch ASYMMETRIC: statutory refreshed on the roster
              // while an allowance edit saved in the same click still showed the
              // old number until navigation.
              emp.allowance  = parseFloat(panel.querySelector('#ep-allow').value)||0;
              emp.deductions = parseFloat(panel.querySelector('#ep-deduct').value)||0;
              emp.deductionsUnearned = Math.min(
                Math.max(parseFloat(panel.querySelector('#ep-deduct-unearned')?.value)||0, 0),
                emp.deductions
              );
            }
          }

          // Cash-advance choice for THIS run (v12 WS22). Writes payroll_ca_overrides
          // as the transition mechanism — CashAdvance.planFor() reads it ahead of
          // WS20's frozen pay_runs.lines[i].caPlan on the next Compute.
          if (caBalance > 0) {
            const mode = panel.querySelector('input[name="ep-ca-mode"]:checked')?.value || 'installment';
            const overrideRef = db.collection('payroll_ca_overrides').doc(`${uid}_${month}`);
            if (mode === 'installment') {
              await overrideRef.delete().catch(()=>{}); // revert to the plan default
            } else {
              const amount = mode === 'full' ? caBalance : Math.min(parseFloat(panel.querySelector('#ep-ca-custom')?.value)||0, caBalance);
              await overrideRef.set({ userId:uid, month, amount, setBy:currentUser.uid, setAt:firebase.firestore.FieldValue.serverTimestamp() });
            }
          }

          closeModal(); Notifs.success('Payroll updated!');
          loadPayrollTable(month);
        }));
      });
    });
  }

  // ── Note to employee (money-adjacent, DISPLAY-ONLY) ─────────────────────
  // HR/finance leaves a note on a specific employee's pay for a specific
  // month; the employee sees it on their payslip and in Personal Finance.
  // Deliberately kept OUT of lines[]/overrides — it lives in its own
  // pay_runs/{month}.employeeNotes[uid] = {text,setBy,setByName,setAt} map,
  // never read by computePayRun/computePayLine, so it can never move
  // finalPay/the ledger/any total no matter when it's added or cleared.
  //
  // Storage target depends on run state, because it must be readable by the
  // EMPLOYEE (pay_runs is finance/admin-only per firestore.rules — an
  // employee reading pay_runs directly is not possible without a rules
  // change) and, per the spec, editable/clearable before AND after disburse:
  //   - state 'computed': written directly on pay_runs/{month}.employeeNotes
  //     (isMoneyAdmin() may update pay_runs while its `state` field doesn't
  //     change — the update rule keys off resource/request state, and a
  //     dot-path update of just employeeNotes.<uid> leaves `state` alone).
  //   - state 'disbursed': the pay_runs doc is rules-immutable from this
  //     point ("no clause below permits updating a disbursed doc" — see
  //     firestore.rules' pay_runs match block) so notes read/write against
  //     the OWNER-READABLE salary_history/{uid}_{month} mirror instead
  //     (`hrNote` field, mirrored once at disburse by disbursePayRun, then
  //     freely editable after — salary_history's own rule has no state gate:
  //     `allow create, update: if isAuth() && isMoneyAdmin();`). This is
  //     exactly the "post-pay correction note" case the spec calls out.
  //   - state 'verified'/'disbursing': genuinely blocked under CURRENT
  //     firestore.rules — the pay_runs update rule has no clause that lets
  //     ANY field change while `state` stays 'verified' (or 'disbursing'),
  //     and salary_history doesn't exist yet (it's only created at
  //     Disburse). Rather than let a write silently fail, this modal
  //     refuses to open and tells HR why. Closing this narrow window would
  //     need a firestore.rules change (out of scope for this pass — see the
  //     pass report for the exact clause).
  async function openEmployeeNoteModal(month, uid, name) {
    const runSnap = await db.collection('pay_runs').doc(month).get().catch(()=>null);
    const runData = (runSnap && runSnap.exists) ? runSnap.data() : null;
    const state   = runData ? (runData.state || 'draft') : 'draft';

    if (state === 'verified' || state === 'disbursing') {
      Notifs.showToast(`Notes can't be edited while this run is ${state==='disbursing'?'disbursing':'Verified but not yet Disbursed'} — wait for Disburse, or ask the President to Reopen the run.`, 'error');
      return;
    }

    const onDisbursed = state === 'disbursed';
    let existing = null;
    if (onDisbursed) {
      const shSnap = await db.collection('salary_history').doc(`${uid}_${month}`).get().catch(()=>null);
      existing = (shSnap && shSnap.exists) ? (shSnap.data().hrNote || null) : null;
    } else {
      existing = (runData && runData.employeeNotes) ? (runData.employeeNotes[uid] || null) : null;
    }
    const lastSetLabel = (existing && existing.setAt && typeof existing.setAt.toDate === 'function')
      ? `Last set by ${escHtml(existing.setByName||'—')} · ${window.fmtManila(existing.setAt)}` : '';

    const _panel = openPage(`Note to ${escHtml(name||'employee')} — ${window.fmtMonthLabel(month)}`, `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${emojiIcon('💬',14)} Shown to the employee on their payslip and Personal Finance pay view. Display-only — never affects any pay calculation.</div>
      <div class="form-group"><label>Note to employee</label><textarea id="emp-note-text" rows="4" placeholder="e.g. Includes prorated 13th month; SSS contribution corrected this month.">${escHtml((existing&&existing.text)||'')}</textarea></div>
      ${lastSetLabel?`<div style="font-size:11px;color:var(--text-muted)">${lastSetLabel}</div>`:''}
    `, `<button class="btn-primary" id="emp-note-save-btn">Save</button>${existing&&existing.text?`<button class="btn-danger" id="emp-note-clear-btn">Clear Note</button>`:''}<button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    // ⚠ SCOPED TO THIS PANEL, NOT document.
    // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second
    // record inside that window and two panels carry the same element ids at
    // once — document.getElementById() returns the FIRST match in document
    // order, which is the DYING panel. At bind time the handler lands on a
    // button nobody can see (the visible one gets none); inside the handler
    // the field reads pull the PREVIOUS record's values and write them onto
    // THIS record. Corporate Secretary report, reproduced 2026-08-10.
    const $note = (id) => _panel.querySelector('#' + id);

    const persist = async (text) => {
      const entry = text ? {
        text,
        setBy: currentUser.uid,
        setByName: window.userProfile?.displayName || currentUser.email,
        setAt: firebase.firestore.FieldValue.serverTimestamp()
      } : firebase.firestore.FieldValue.delete();
      if (onDisbursed) {
        await db.collection('salary_history').doc(`${uid}_${month}`).update({ hrNote: entry });
      } else {
        await db.collection('pay_runs').doc(month).update({ ['employeeNotes.'+uid]: entry });
      }
      window.logAudit && window.logAudit(
        text ? 'employee-note-set' : 'employee-note-clear',
        onDisbursed ? 'salary_history' : 'pay_run',
        onDisbursed ? `${uid}_${month}` : month,
        { uid, month }
      );
    };

    $note('emp-note-save-btn').addEventListener('click', () => window.busy($note('emp-note-save-btn'), async () => {
      const text = $note('emp-note-text').value.trim();
      if (!text) { Notifs.showToast('Enter a note, or use Clear Note to remove an existing one.','error'); return; }
      await persist(text);
      closeModal();
      Notifs.success('Note saved.');
      loadPayrollTable(month);
    }));

    $note('emp-note-clear-btn')?.addEventListener('click', () => window.busy($note('emp-note-clear-btn'), async () => {
      if (!(await confirmDialog({message:`Clear the note for ${escHtml(name||'')}?`}))) return;
      await persist(null);
      closeModal();
      Notifs.success('Note cleared.');
      loadPayrollTable(month);
    }));
  }

  // ── Adjust / Reset — per-line overrides (payroll recall spec §C4) ──────
  // Only reachable from the frozen-run table (§B3) when state==='computed'.
  // Overrides are stored on pay_runs/{month}.overrides[uid] (§C1) and applied
  // by computePayRun itself (§C3/§C2) — Save/Reset both just write the
  // override map then re-run computePayRun so the frozen lines[] stay the
  // single source of truth (no separate client-side money math to drift).
  async function openAdjustModal(month, uid) {
    const runSnap = await db.collection('pay_runs').doc(month).get().catch(()=>null);
    const runData = (runSnap && runSnap.exists) ? runSnap.data() : null;
    if (!runData) { Notifs.showToast('Could not load this run.','error'); return; }
    const line = (runData.lines||[]).find(l=>l.uid===uid);
    if (!line) { Notifs.showToast('No computed line for this employee.','error'); return; }
    const existing = (runData.overrides||{})[uid];
    // "Computed" reference column: if already overridden, show the TRUE
    // original computed values captured when the override was first saved
    // (line.overrideMeta.original) — not the post-override numbers now
    // sitting on the line — so re-opening Adjust never treats an override
    // as if it were freshly computed.
    const base = (line.overridden && line.overrideMeta && line.overrideMeta.original) ? line.overrideMeta.original : {
      kpiScore: line.kpiScore, attScore: line.attScore, allowance: line.allowance,
      otherDeductions: line.otherDeductions, finalPay: line.finalPay
    };
    const emp = employees.find(e=>e.id===uid);

    const FIELD_DEFS = [
      ['kpiScore','KPI Score (0–1)',0.01,'',0,1],
      ['attScore','Attendance Score (0–1)',0.01,'',0,1],
      ['allowance','Allowance',0.01,'₱',0,null],
      ['otherDeductions','Other Deductions',0.01,'₱',0,null],
      ['finalPay','Final Pay / Take-home',0.01,'₱',null,null],
    ];
    const fieldHtml = FIELD_DEFS.map(([key,label,step,prefix,min,max]) => `
      <div class="form-row">
        <div class="form-group"><label>${label} — Computed</label>
          <div style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2,var(--surface));color:var(--text-muted)">${typeof base[key]==='number'?(prefix+fmt(base[key])):'—'}</div>
        </div>
        <div class="form-group"><label>${label} — Override</label>
          <input id="adj-${key}" type="number" step="${step}" ${min!=null?`min="${min}"`:''} ${max!=null?`max="${max}"`:''} value="${existing && typeof existing[key]==='number' ? existing[key] : ''}" placeholder="blank = no override"/>
        </div>
      </div>`).join('');

    const _panel = openPage(`Adjust — ${escHtml(line.name||'')} (${window.fmtMonthLabel(month)})`, `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Overrides apply on top of this frozen computed run and are fully reversible before Verify. Leave a field blank to keep it as computed.</div>
      ${fieldHtml}
      <div id="adj-negative-warn" style="display:none;color:var(--danger);font-size:12px;margin:4px 0"></div>
      <div class="form-group"><label>Reason (required)</label><input id="adj-note" placeholder="Why is this override needed?" value="${escHtml((existing&&existing.note)||'')}"/></div>
      <div style="font-size:13px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">Preview net pay: <strong id="adj-preview-final">₱${fmt(line.finalPay)}</strong></div>
    `, `<button class="btn-primary" id="adj-save-btn">Save</button>${existing?`<button class="btn-danger" id="adj-reset-btn">Reset to computed</button>`:''}<button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    // ⚠ SCOPED TO THIS PANEL, NOT document.
    // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second
    // record inside that window and two panels carry the same element ids at
    // once — document.getElementById() returns the FIRST match in document
    // order, which is the DYING panel. At bind time the handler lands on a
    // button nobody can see (the visible one gets none); inside the handler
    // the field reads pull the PREVIOUS record's values and write them onto
    // THIS record. Corporate Secretary report, reproduced 2026-08-10.
    const $adj = (id) => _panel.querySelector('#' + id);

    const numVal = (key) => {
      const v = $adj(`adj-${key}`)?.value;
      return (v === '' || v == null) ? undefined : parseFloat(v);
    };
    const updatePreview = () => {
      const kpiScore = numVal('kpiScore'), attScore = numVal('attScore');
      const allowance = numVal('allowance'), otherDeductions = numVal('otherDeductions'), finalPayOvr = numVal('finalPay');
      const empEff = emp
        ? { ...emp, allowance: allowance!=null?allowance:emp.allowance, deductions: otherDeductions!=null?otherDeductions:emp.deductions }
        : { id: line.uid, displayName: line.name, salary: line.base, allowance: allowance!=null?allowance:line.allowance, deductions: otherDeductions!=null?otherDeductions:line.otherDeductions };
      let preview = window.computePayLine(empEff, {
        month, policy: line.policy,
        kpiScore: kpiScore!=null?kpiScore:line.kpiScore, attScore: attScore!=null?attScore:line.attScore,
        caPlan: line.caPlan, caBalance: line.caBalance
      });
      if (finalPayOvr != null) preview = window.applyPayLineOverride(preview, { finalPay: finalPayOvr, note:'preview' });
      const warnEl = $adj('adj-negative-warn');
      if (warnEl) {
        if (preview.finalPay < 0) { warnEl.style.display='block'; warnEl.textContent = `Warning: preview take-home is negative (₱${fmt(preview.finalPay)}).`; }
        else { warnEl.style.display='none'; }
      }
      const prevEl = $adj('adj-preview-final');
      if (prevEl) prevEl.textContent = `₱${fmt(preview.finalPay)}`;
    };
    FIELD_DEFS.forEach(([key]) => $adj(`adj-${key}`)?.addEventListener('input', updatePreview));

    $adj('adj-save-btn')?.addEventListener('click', () => window.busy($adj('adj-save-btn'), async () => {
      const note = $adj('adj-note').value.trim();
      if (!note) { Notifs.showToast('Reason is required.','error'); return; }
      // Stale-page guard — mirrors the Verify handler's re-check pattern below.
      const chk = await db.collection('pay_runs').doc(month).get().catch(()=>null);
      if (!chk || !chk.exists || chk.data().state !== 'computed') {
        Notifs.showToast('Run must be in Computed state to adjust — it may have been Verified already.','error');
        closeModal(); loadPayRunStrip(month); loadPayrollTable(month); return;
      }
      const entry = {
        note, setBy: currentUser.uid, setByName: window.userProfile?.displayName||currentUser.email,
        setAt: firebase.firestore.FieldValue.serverTimestamp(),
        original: { kpiScore: base.kpiScore, attScore: base.attScore, allowance: base.allowance, otherDeductions: base.otherDeductions, finalPay: base.finalPay }
      };
      const fieldsSet = [];
      FIELD_DEFS.forEach(([key]) => { const v = numVal(key); if (v != null) { entry[key] = v; fieldsSet.push(key); } });
      await db.collection('pay_runs').doc(month).update({ ['overrides.'+uid]: entry });
      await window.computePayRun(month);
      window.logAudit && window.logAudit('payroll-override','pay_run',month,{ uid, fields: fieldsSet, note, before: entry.original });
      closeModal();
      Notifs.success('Override saved — run recomputed.');
      loadPayRunStrip(month); loadPayrollTable(month); loadUnpaidStrip();
    }));

    $adj('adj-reset-btn')?.addEventListener('click', () => window.busy($adj('adj-reset-btn'), async () => {
      if (!(await confirmDialog({message:`Reset ${escHtml(line.name||'')}'s ${window.fmtMonthLabel(month)} pay to the computed values? This clears the override.`}))) return;
      await db.collection('pay_runs').doc(month).update({ ['overrides.'+uid]: firebase.firestore.FieldValue.delete() });
      await window.computePayRun(month);
      window.logAudit && window.logAudit('payroll-override-reset','pay_run',month,{ uid });
      closeModal();
      Notifs.success('Override cleared — run recomputed.');
      loadPayRunStrip(month); loadPayrollTable(month); loadUnpaidStrip();
    }));
  }

  // ── Pay-run workflow: Compute → Verify → Disburse (per month) ──────────
  // Explicit, auditable states wrapping the existing salary computation (which
  // is unchanged). A pay_runs/{YYYY-MM} doc tracks the state + who/when. Compute
  // = the Generate button; Verify = finance/admin sign-off; Disburse = President
  // marks salaries actually released. Grace period: finalize by the 5th.
  const PR_STATES = ['draft','computed','verified','disbursed'];
  const PR_LABEL  = { draft:'Draft', computed:'Computed', verified:'Verified', disbursed:'Disbursed' };
  async function loadPayRunStrip(month){
    const wrap = document.getElementById('pay-run-strip'); if(!wrap) return;
    const doc  = await db.collection('pay_runs').doc(month).get().catch(()=>null);
    const data = (doc && doc.exists) ? doc.data() : {};
    // 'disbursing' is a transient lock state between verified and disbursed
    // (Part E Phase 11) — treat it as 'verified' for the pipeline badge row;
    // the dedicated amber badge below shows the lock explicitly.
    const state = PR_STATES.includes(data.state) ? data.state : (data.state==='disbursing' ? 'verified' : 'draft');
    const idx   = PR_STATES.indexOf(state);
    const day   = parseInt((window.bizDate?window.bizDate():'0000-00-00').slice(8,10),10) || 0;
    const isCurrent = month === thisMonth;
    const grace = (isCurrent && idx < 2)
      ? `Finalize this run by the <strong>5th</strong>${day>5?` — <span style="color:var(--danger)">overdue (day ${day})</span>`:` (today is day ${day})`}.`
      : '';
    wrap.innerHTML = `
      <div class="card"><div class="card-body" style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${PR_STATES.map((s,i)=>`<span class="badge ${i<idx?'badge-blue':i===idx?'badge-green':'badge-gray'}" style="font-size:11px">${i<=idx?`${emojiIcon('✓',16)} `:''}${PR_LABEL[s]}</span>${i<PR_STATES.length-1?'<span style="color:var(--text-muted)">→</span>':''}`).join('')}
          <span style="flex:1"></span>
          ${data.totalNet!=null?`<span style="font-size:12px;color:var(--text-muted)">Net ₱${fmt(data.totalNet)} · ${data.employeeCount||0} staff</span>`:''}
        </div>
        ${grace?`<div style="font-size:12px;color:var(--text-muted)">${emojiIcon('⏳',12)} ${grace}</div>`:''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${(canFinance && state==='computed')?`<button class="btn-secondary btn-sm" id="pr-verify-btn">${emojiIcon('✓',16)} Mark Verified</button>`:''}
          ${(isPres && state==='verified' && data.state!=='disbursing')?`<button class="btn-primary btn-sm" id="pr-disburse-btn">${emojiIcon('💵',16)} Disburse</button><button class="btn-secondary btn-sm" id="pr-reopen-btn">↺ Reopen</button>`:''}
          ${state==='draft'?`<span style="font-size:12px;color:var(--text-muted)">Use <strong>Compute Payroll</strong> to start this month's run.</span>`:''}
          ${data.state==='disbursing'?`<span class="badge badge-amber" style="font-size:11px">${emojiIcon('🔒',12)} Disbursing… (locked)${data.disbursingByName?` — started by ${escHtml(data.disbursingByName)}`:''}</span>${isPres?`<button class="btn-primary btn-sm" id="pr-resume-btn">Resume Disburse</button><button class="btn-secondary btn-sm" id="pr-unlock-btn">↺ Reopen (unlock)</button>`:''}`:''}
          ${state==='disbursed'&&data.disbursedAt?`<span style="font-size:12px;color:var(--success)">${emojiIcon('💵',12)} Disbursed${data.disbursedByName?` by ${escHtml(data.disbursedByName)}`:''}</span>`:''}
        </div>
      </div></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    // Verify — only from 'computed' (re-checked here, not just hidden by the UI,
    // since a stale page could still fire a click after someone else acted).
    document.getElementById('pr-verify-btn')?.addEventListener('click', async ()=>{
      const chk = await db.collection('pay_runs').doc(month).get().catch(()=>null);
      if (!chk || !chk.exists || chk.data().state !== 'computed') { Notifs.showToast('Run must be Computed before Verify.','error'); loadPayRunStrip(month); return; }
      const chkData = chk.data();
      const overrideCount = (chkData.lines||[]).filter(l=>l.overridden).length;
      const overrideNote = overrideCount ? ` — includes ${overrideCount} manual override(s)` : '';
      if(!(await confirmDialog({message:`Mark ${month} payroll as VERIFIED? This confirms the computed amounts have been checked.${overrideNote}`}))) return;
      await db.collection('pay_runs').doc(month).set({ state:'verified', verifiedBy:currentUser.uid, verifiedByName:window.userProfile?.displayName||currentUser.email, verifiedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      window.logAudit && window.logAudit('update','pay_run',month,{state:'verified'});
      Notifs.success('Payroll marked verified.'); loadPayRunStrip(month); loadUnpaidStrip();
    });
    // Disburse — v12 WS20 D6: THE single mutating step (CA deducted, ledger
    // posted, salary_history frozen, employees notified). Terminal afterward.
    document.getElementById('pr-disburse-btn')?.addEventListener('click', async ()=>{
      const chk = await db.collection('pay_runs').doc(month).get().catch(()=>null);
      const data2 = (chk && chk.exists) ? chk.data() : {};
      const overrideCount2 = (data2.lines||[]).filter(l=>l.overridden).length;
      const bankOpts = await window.BankAccounts.optionsHTML();
      openModal(`Disburse ${month} payroll`, `
        <p style="font-size:13px;margin-bottom:10px">₱${fmt(data2.totalNet||0)} to ${data2.employeeCount||0} staff${overrideCount2?` — includes ${overrideCount2} manual override(s)`:''}. This deducts cash advances, posts the ledger, and notifies employees. <strong>This cannot be undone.</strong></p>
        <div class="form-group"><label>Paid from (company account)</label>
          <select id="pr-bankacct" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select></div>
      `, `<button class="btn-danger" id="pr-disburse-go">Disburse</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('pr-disburse-go').addEventListener('click', async ()=>{
        const goBtn = document.getElementById('pr-disburse-go');
        goBtn.disabled = true; // synchronous UI-side lock (Part E Phase 11 covers the transactional half)
        const sel = document.getElementById('pr-bankacct').value;
        if (!sel && (await window.BankAccounts.list()).length) { Notifs.showToast('Select the paying account.','error'); goBtn.disabled = false; return; }
        const acct = await window.BankAccounts.pick(sel);
        closeModal();
        const dbtn = document.getElementById('pr-disburse-btn');
        if (dbtn) { dbtn.disabled = true; dbtn.textContent = 'Disbursing…'; }
        try { await window.disbursePayRun(month, { bankAccount: acct }); Notifs.success('Payroll disbursed!'); }
        catch (err) { Notifs.showToast(err.message || 'Could not disburse payroll.', 'error'); }
        loadPayRunStrip(month); loadUnpaidStrip();
        loadFinanceContent(currentUser, currentRole, 'Payroll');
      });
    });
    // Reopen — president-only, verified → computed (v12 WS20 D5).
    document.getElementById('pr-reopen-btn')?.addEventListener('click', async ()=>{
      if(!(await confirmDialog({message:`Reopen ${month} payroll for editing? This returns it to Computed — Verify again before Disburse.`}))) return;
      await window.reopenPayRun(month);
      loadPayRunStrip(month); loadUnpaidStrip();
    });
    // Resume a stuck 'disbursing' run — idempotent re-run of disbursePayRun
    // via the deterministic PAY-{month}-{uid} refs (Part E Phase 11).
    document.getElementById('pr-resume-btn')?.addEventListener('click', async ()=>{
      if(!(await confirmDialog({message:`Resume disbursing ${month} payroll? This safely re-runs the disburse step — already-posted rows are updated in place, not duplicated. Cash-advance deductions already taken for this month are skipped automatically.`}))) return;
      const acct = await window.BankAccounts.pick(null).catch(()=>({ bankAccountId:null, bankAccountName:null }));
      try { await window.disbursePayRun(month, { bankAccount: acct }); Notifs.success('Payroll disbursed!'); }
      catch (err) { Notifs.showToast(err.message || 'Could not resume disbursement.', 'error'); }
      loadPayRunStrip(month); loadUnpaidStrip();
      loadFinanceContent(currentUser, currentRole, 'Payroll');
    });
    // Manual unlock of a stuck 'disbursing' run — president-only, routes
    // through reopenPayRun's disbursing→computed branch (Part E Phase 11).
    document.getElementById('pr-unlock-btn')?.addEventListener('click', async ()=>{
      if(!(await confirmDialog({message:`Unlock ${month} payroll? Only do this after confirming the disburse step actually failed/stalled — this returns the run to Computed.`, danger:true}))) return;
      await window.reopenPayRun(month);
      loadPayRunStrip(month); loadUnpaidStrip();
    });
  }

  loadPayrollTable(thisMonth);
  loadPayRunStrip(thisMonth);
  loadUnpaidStrip();
  document.getElementById('pr-month-sel').addEventListener('change', e => { loadPayrollTable(e.target.value); loadPayRunStrip(e.target.value); });
  document.getElementById('raise-history-btn')?.addEventListener('click', () => openRaiseHistory());
  document.getElementById('payroll-recon-btn')?.addEventListener('click', () => openPayrollReconciliation());
  document.getElementById('pr-view-raises')?.addEventListener('click', () => window.openScheduledRaises());

  document.getElementById('gen-payroll-btn').addEventListener('click', async () => {
    const month = document.getElementById('pr-month-sel').value;

    // Compute is allowed only in draft/computed — once Verified, the President
    // must Reopen first (v12 WS20 D5: kills the old silent disburse→computed
    // regression, where Compute could be re-clicked after Verify/Disburse).
    const runSnap  = await db.collection('pay_runs').doc(month).get().catch(()=>null);
    const runState = (runSnap && runSnap.exists) ? (runSnap.data().state||'draft') : 'draft';
    if (['verified','disbursed'].includes(runState)) {
      Notifs.showToast(`Run is ${runState} — President must Reopen first.`, 'error');
      return;
    }
    if (!(await confirmDialog({message:`Compute payroll for ${window.fmtMonthLabel(month)}? Safe to re-run before Verify — no money moves until Disburse.`}))) return;
    // Checked once, before any write — a closed month can't be (re)computed
    // (v12 WS12; toast shown by assertPeriodOpen if blocked).
    try { await window.assertPeriodOpen(month + '-01'); } catch (e) { return; }

    const btn = document.getElementById('gen-payroll-btn');
    btn.disabled = true; btn.textContent = 'Computing…';
    try {
      await window.computePayRun(month);
      Notifs.success('Payroll computed!');
    } catch (err) {
      Notifs.showToast(err.message || 'Could not compute payroll.', 'error');
    }
    loadFinanceContent(currentUser, currentRole, 'Payroll');
  });

  // v12 WS24 — the two print buttons were dead UI (no handler ever attached).
  // Delegated on the tbody since rows re-render on every loadPayrollTable call.
  document.getElementById('payroll-tbody').addEventListener('click', async (e) => {
    const b = e.target.closest('.print-slip-btn'); if (!b) return;
    const month = document.getElementById('pr-month-sel').value;
    const runDoc = await db.collection('pay_runs').doc(month).get().catch(()=>null);
    const line = runDoc?.exists ? (runDoc.data().lines||[]).find(l=>l.uid===b.dataset.uid) : null;
    let model;
    if (line) {
      // Note to employee (display-only) — prefer the post-disburse
      // salary_history mirror (correctable anytime after disburse) over the
      // pre-disburse pay_runs.employeeNotes map, which freezes once disbursed.
      let hrNote = (runDoc.data().employeeNotes||{})[b.dataset.uid] || null;
      if (runDoc.data().state === 'disbursed') {
        const shSnap = await db.collection('salary_history').doc(`${b.dataset.uid}_${month}`).get().catch(()=>null);
        if (shSnap?.exists) hrNote = shSnap.data().hrNote || null;
      }
      model = window.toPayslipModel({...line, month, hrNote}, 'monthly');
      model.official = runDoc.data().state === 'disbursed';
      model.payDateLabel = runDoc.data().disbursedAt ? new Date(runDoc.data().disbursedAt.toDate()).toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}) : '';
    } else {
      // Interim projection — no computed line for this month yet.
      const emp = employees.find(u=>u.id===b.dataset.uid);
      if (!emp) return;
      // PAYSLIP-OVERHAUL-SPEC.md §6 — the statutory-0 bug. This branch used to
      // spread the raw merged user+payroll doc straight into toPayslipModel,
      // which only reads STORED fields (g(source,'sss') etc, hr.js's
      // toPayslipModel) — any employee with no hand-typed sss/philhealth/
      // pagibig/tax on payroll/{uid} showed a hard 0 for all three AND a
      // silently overstated net (never ran through computeStatutory at all).
      // Fix: route through the ONE pay engine first — exactly like
      // dashboards.js's my-payslip-btn (renderPersonalFinance) already does —
      // so the same "hand-typed wins, else the WS21 statutory-table
      // suggestion" rule the roster preview itself uses applies here too.
      const line = window.computePayLine(emp, { month, policy:'flat' });
      model = window.toPayslipModel({...line, uid:emp.id, month}, 'monthly');
      // computePayLine's return object carries only pay-math fields (no
      // employeeId/department/jobTitle/gov IDs) — restore those display-only
      // passthrough fields from `emp` (same zero-risk pattern dashboards.js's
      // my-payslip-btn already uses for name/idNumber/department) so this
      // button doesn't regress fields the roster already had on file. Never
      // touches computePayLine's math outputs.
      model.employee.name       = emp.displayName || emp.email || '';
      model.employee.idNumber   = emp.employeeId || '';
      model.employee.department = emp.department || (Array.isArray(emp.departments) && emp.departments.length ? emp.departments.join(', ') : '');
      model.employee.jobTitle   = emp.title || '';
      model.employee.tin        = emp.tinNum || '';
      model.employee.sss        = emp.ssNum || '';
      model.employee.philhealth = emp.phNum || '';
      model.employee.pagibig    = emp.pagibigNum || '';
      model.official = false;
    }
    model.ytd = await window.payslipYtdMonthly(b.dataset.uid, window.bizYear?window.bizYear():new Date().getFullYear());
    window.renderPayslipPage(model, () => window.renderFinance(currentUser, currentRole, 'Payroll'));
  });
  document.getElementById('print-payroll-btn').addEventListener('click', async () => {
    const month = document.getElementById('pr-month-sel').value;
    const runDoc = await db.collection('pay_runs').doc(month).get().catch(()=>null);
    const lines = runDoc?.exists ? (runDoc.data().lines||[]) : [];
    if (!lines.length) { Notifs.showToast('No computed pay run for this month yet.','error'); return; }
    const year = window.bizYear ? window.bizYear() : new Date().getFullYear();
    const official = runDoc.data().state === 'disbursed';
    const employeeNotes = runDoc.data().employeeNotes || {};
    // Same disbursed-mirror preference as the single-print handler above, but
    // as ONE query for the whole month instead of N per-employee reads.
    let shNoteByUid = {};
    if (official) {
      const shSnap = await db.collection('salary_history').where('month','==',month).get().catch(()=>({docs:[]}));
      shSnap.docs.forEach(d => { const dd = d.data(); if (dd.hrNote) shNoteByUid[dd.userId] = dd.hrNote; });
    }
    const models = await Promise.all(lines.map(async l => {
      const hrNote = official ? (shNoteByUid[l.uid] || null) : (employeeNotes[l.uid] || null);
      const mdl = window.toPayslipModel({...l, month, hrNote}, 'monthly');
      mdl.official = official;
      mdl.ytd = await window.payslipYtdMonthly(l.uid, year);
      return mdl;
    }));
    const host = document.getElementById('page-content');
    // PAYSLIP-OVERHAUL-SPEC.md §3 — each payslip gets its own stage/sheet;
    // page-break-after:always stays on the .payslip-print div itself (same
    // element it was always on — .a4-sheet/.payslip-print share one div,
    // per renderPayslipPage's wrapper above), .a4-stage is purely the extra
    // outer centering box — fitA4Sheet still runs a one-shot {live:false} fit so
    // a phone opening this screen before hitting Print doesn't get a fixed 794px
    // sheet wider than its viewport (horizontal scroll).
    //
      // batch-PDF-on-iOS now WORKS, within a hard limit it cannot exceed: the
      // single-canvas capture is bounded by iOS's canvas AREA, so about 18 A4
      // sheets at scale 1. Above that the handler refuses with guidance rather
      // than emitting a blank file — see the ceiling note in the click handler.
      // It is NOT unconditionally solved; do not read this as closed.
    // follow-up" is now DONE. Print All was a bare window.print(), i.e. dead in
    // the iOS Add-to-Home-Screen webview (§4 of this file documents exactly
    // that), so on the phone this screen was a preview with no way out to paper
    // or PDF. It now opens the batch as a real printable document via
    // window.openPrintableDoc, whose iOS path captures the sheets and hands a
    // multi-page PDF to the native share sheet (_shareDocPDF slices by canvas
    // height, one PDF page per sheet-height slice). The on-screen preview and
    // the Back button are unchanged.
    host.innerHTML = `
      <div class="no-print" style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
        <button class="btn-secondary btn-sm" id="ps-back-btn">← Back</button>
        <button class="btn-primary btn-sm" id="ps-print-all-btn">${emojiIcon('🖨',16)} Print All</button>
      </div>
      ${models.map(mdl => `<div class="a4-stage"><div class="a4-sheet payslip-print" style="page-break-after:always">${window.buildPayslipHTML(mdl)}</div></div>`).join('')}`;
    if (window.lucide) lucide.createIcons({ nodes: [host] });
    if (typeof window.fitA4Sheet === 'function') window.fitA4Sheet(host, { live:false });
    host.querySelector('#ps-back-btn')?.addEventListener('click', () => window.renderFinance(currentUser, currentRole, 'Payroll'));
    host.querySelector('#ps-print-all-btn')?.addEventListener('click', () => {
      if (typeof window.openPrintableDoc !== 'function') { try { window.print(); } catch (_) {} return; }
      // ── CANVAS-AREA CEILING (2026-08-08) ───────────────────────────────────
      // The iOS PDF path captures the WHOLE panel as ONE canvas and only then
      // slices it into pages, so a batch is limited by iOS's ~16.7 MP canvas
      // area — not by page count. One A4 sheet is 794x1123 = 0.892 MP, so about
      // 4 sheets at scale 2 and about 18 at scale 1.
      //
      // This MUST be decided up front, because the existing "retry at scale 1"
      // fallback cannot catch it: above the cap WebKit hands back a
      // non-allocated backing store, drawing becomes a no-op, and toBlob
      // resolves with a VALID BUT BLANK jpeg. Nothing throws. The user would be
      // handed a blank multi-page payroll PDF that looks like it worked — for a
      // money document, worse than the dead button this replaced.
      const SHEET_MP   = (794 * 1123) / 1e6;      // 0.892 MP per A4 sheet
      const CANVAS_CAP = 16.7;                     // iOS, per print-docs.js's own note
      const maxAt = (sc) => Math.max(1, Math.floor(CANVAS_CAP / (SHEET_MP * sc * sc)));
      const n = models.length;
      const scale = n <= maxAt(2) ? 2 : 1;
      if (n > maxAt(1)) {
        const per = maxAt(1);
        window.confirmDialog?.({
          title: 'Too many payslips for one file',
          message: `This run has <strong>${n}</strong> payslips. A single PDF can hold about `
            + `<strong>${per}</strong> before the phone silently produces a blank file, so this `
            + `would not be trustworthy. Print them in batches of ${per} or fewer — or use a `
            + `desktop browser, which has no such limit.`,
          html: true, confirmLabel: 'Got it', cancelLabel: null
        }) || Notifs.showToast(`Too many payslips for one PDF (${n}) — print in batches of ${per}.`, 'error');
        return;
      }
      // Built from `models` directly rather than snapshotted from the DOM: the
      // on-screen copy carries fitA4Sheet's scale-to-fit transform and the
      // .a4-stage centring box, neither of which belongs on the printed sheet.
      window.openPrintableDoc({
        title: 'Payslips — ' + month,
        scale,   // chosen above from the sheet count, never blindly 2
        barLabel: `${emojiIcon('🖨',16)} Payslips — ${escHtml(month)} (${models.length})`,
        pageId: 'payslip-batch-page',
        accent: '#1E3A5F',
        // .payslip-print carries its own complete styling in css/styles.css, so
        // the only deltas needed are (a) pinning the sheet width — print-docs.js
        // §4: a .page with no width exports at CONTENT width — and (b) undoing
        // `@media print{ .payslip-print{position:absolute;left:0;top:0} }`,
        // which is correct for ONE payslip but stacks every sheet of a batch on
        // top of each other at top:0.
        pageCss: `
.pd-print.page{width:794px;padding:0;background:#fff}
.pd-print .a4-sheet{width:794px;min-height:1123px;transform:none;box-shadow:none;border:none;margin:0 auto}
@media print{
  .pd-print .payslip-print{position:static!important;padding:0!important;width:100%!important}
  .pd-print .a4-sheet{page-break-after:always;break-after:page}
  .pd-print .a4-sheet:last-child{page-break-after:auto;break-after:auto}
}`,
        bodyHtml: models.map(mdl => `<div class="a4-sheet payslip-print">${window.buildPayslipHTML(mdl)}</div>`).join('')
      });
    });
  });
}

// ── HR Profiles + Payslip Generator ─────────────────
// BI-W-### atomic worker ID (mirrors the _counters/employees pattern, app.js:498-500).
window.nextWorkerIdNumber = async function() {
  const ref = db.collection('_counters').doc('workers');
  return db.runTransaction(async t => {
    const c = await t.get(ref);
    const next = (c.exists ? (c.data().count || 0) : 0) + 1;
    t.set(ref, { count: next }, { merge: true });
    return `BI-W-${String(next).padStart(3,'0')}`;
  });
};

// v12 WS28 — seed/refresh worker_directory from worker_profiles (finance/admin only;
// idempotent set-merge; prunes directory docs whose profile was deleted).
window.syncWorkerDirectory = async function(){
  const [ps, ds] = await Promise.all([
    db.collection('worker_profiles').get(),
    db.collection('worker_directory').get().catch(()=>({docs:[]}))
  ]);
  const live = new Set(ps.docs.map(d=>d.id));
  for (const d of ps.docs){ const p=d.data();
    await db.collection('worker_directory').doc(d.id).set({
      name:p.name||'', idNumber:p.idNumber||'', jobTitle:p.jobTitle||'',
      department:p.department||'', status:p.status||'active', photoUrl:p.photoUrl||'',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true }); }
  for (const d of ds.docs) if (!live.has(d.id)) await db.collection('worker_directory').doc(d.id).delete().catch(()=>{});
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('worker_directory');
  return ps.size;
};

// Ensure a worker_profiles doc has a stable verify token + fresh public projection.
async function ensureWorkerVerifyToken(profile) {
  const proj = window.buildIdVerifyDoc('worker', profile, null);
  if (profile.verifyToken) {
    db.collection('id_verify').doc(profile.verifyToken).set(proj, { merge:true }).catch(()=>{});
    return profile.verifyToken;
  }
  const token = window.makeTrackCode(10);
  // v14 re-audit ROUND 2 — ORDER MATTERS. worker_profiles create/update is
  // money-tier now (isMoneyAdmin), so for a Corporate Secretary the profile
  // write below is refused. Writing the public id_verify projection FIRST meant
  // every refused attempt left an orphan id_verify doc behind — a QR token
  // pointing at a card nobody can reach, accumulating one per click of 🪪 ID /
  // Batch Print. Claim the token on the profile first: if that is denied we
  // throw before minting anything, and both callers already fold the throw into
  // "The card will print without a QR". The reverse partial failure (profile
  // stamped, projection not written) is self-healing — the `profile.verifyToken`
  // branch above re-writes the projection on the next open.
  await db.collection('worker_profiles').doc(profile.id).set({ verifyToken: token }, { merge:true });
  await db.collection('id_verify').doc(token).set(proj);
  profile.verifyToken = token;
  return token;
}

window.openWorkerIDModal = async function(profile, onDone) {
  if (!profile) return;   // sync, in-memory — stays ahead of openPage
  // ── WINDOW FIRST, DATA SECOND (v14.0.71) ────────────────────────────────
  // ensureWorkerVerifyToken() is a round-trip (and, first time round, two
  // writes) and openPage used to wait for it, so tapping 🪪 ID on a worker row
  // did nothing visible until it finished. The panel opens synchronously with
  // a skeleton body now; the title comes from `profile`, already in hand, so
  // it is final at open time.
  //
  // Print ships DISABLED because it is the one control that genuinely needs
  // the token (window.printIDCards is handed it directly); it is enabled the
  // line after the card renders, leaving the footer markup identical to what
  // it always was. Close is inline onclick and live immediately.
  const panel = openPage(`${emojiIcon('🪪',16)} Worker ID — ` + escHtml(profile.name||''),
    window.skeletonHtml('rows', 2),
    `<button class="btn-primary" id="wid-print" disabled>${emojiIcon('🖨',16)} Print / Save PDF</button><button class="btn-secondary" onclick="closeModal()">Close</button>`);
  const bodyEl = panel.querySelector('.page-panel-body');

  let token = null;
  try {
    token = await ensureWorkerVerifyToken(profile).catch(()=>null);
  } catch (err) {
    // Defensive only — the .catch above already folds the expected
    // permission/network failure into `token = null`, which the body below
    // renders as the "could not create a verify link" note exactly as before.
    // This catch exists so a synchronous throw can never leave an eternal
    // skeleton behind the newly-opened window.
    if (panel.isConnected) _hrPanelError(bodyEl, err);
    if (onDone) onDone();
    return;
  }
  // CLOSED MID-FLIGHT — Back before the token lands. onDone still fires: it
  // refreshes the list UNDERNEATH this panel and was never scoped to it.
  if (!panel.isConnected) { if (onDone) onDone(); return; }
  const url = (window.BRAND?.verifyBase || '/v/') + '?' + encodeURIComponent(token||'');
  const qr = (window.buildQRSVG && token) ? window.buildQRSVG(url, 120) : '';
  bodyEl.innerHTML = `
    <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="width:90px;height:110px;border:1px solid var(--border);border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--surface2);font-size:34px">
        ${profile.photoUrl?`<img src="${escHtml(profile.photoUrl)}" style="width:100%;height:100%;object-fit:cover"/>`:`${emojiIcon('👤',16)}`}</div>
      <div style="flex:1;min-width:160px">
        <div style="font-size:17px;font-weight:800">${escHtml(profile.name||'')}</div>
        <div style="font-size:12px;color:var(--text-muted)">${escHtml(profile.jobTitle||'')}</div>
        <div style="font-size:12px;margin-top:4px">ID: <b>${escHtml(profile.idNumber||'—')}</b></div>
        <div style="font-size:12px">${escHtml(profile.department||'')} · ${escHtml(profile.employmentType||'')}</div>
      </div>
      <div style="width:120px;height:120px">${qr||`<div style="font-size:10px;word-break:break-all">${escHtml(url)}</div>`}</div>
    </div>
    ${token?`<p style="font-size:11px;color:var(--text-muted);margin-top:12px">Verify link: <a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(url)}</a></p>`:'<p style="font-size:11px;color:var(--danger);margin-top:12px">Could not create a verify link (permission). The card will print without a QR.</p>'}
  `;
  panel.querySelector('#wid-print')?.removeAttribute('disabled');
  // emojiIcon('👤') in the photo fallback — hydrate what was just injected.
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
  // LISTENER AFTER THE FILL — #wid-print only exists in the footer, which was
  // rendered at open time, but it is bound here so it can never fire before
  // `token` is resolved.
  panel.querySelector('#wid-print')?.addEventListener('click', () => {
    window.printIDCards([window.buildIdVerifyDoc('worker', profile, null)], [token||'']);
  });
  if (onDone) onDone();
};

window.batchPrintWorkerIDs = async function(profiles) {
  if (!profiles || !profiles.length) { Notifs.showToast('No active worker profiles to print','error'); return; }
  Notifs.showToast('Preparing '+profiles.length+' ID cards…');
  const tokens = [];
  for (const p of profiles) tokens.push(await ensureWorkerVerifyToken(p).catch(()=>''));
  window.printIDCards(profiles.map(p=>window.buildIdVerifyDoc('worker', p, null)), tokens);
};

async function renderFinanceHRProfiles(container, currentUser, currentRole) {
  const isPriv = isFinancePriv();
  // v14 re-audit fix — isPriv (isFinancePriv) is true for 'secretary' and for
  // any Finance-DEPARTMENT member, but firestore.rules now gates every
  // pay-bearing write on isMoneyAdmin() (president/manager/finance). Controls
  // that write worker RATES/allowances/CA balance or issue a payslip use
  // isPayPriv so we don't render a button whose write the boundary will
  // refuse; the oversight controls a secretary legitimately keeps (payslip &
  // raise history, batch ID print, the attendance Clock kiosk, and the
  // read-only roster itself) stay on isPriv. For a Finance-dept member of
  // role 'employee' this also fixes a PRE-EXISTING mismatch: those buttons
  // were shown to them but the rules have always denied the write.
  const isPayPriv = (typeof isMoneyPriv === 'function') ? isMoneyPriv() : isPriv;
  container.innerHTML = window.skeletonHtml('cards');
  // v12 WS23 — same due-raise sweep as the monthly Payroll screen, for the
  // worker_profile subjectType (dailyRate/hourlyRate).
  await window.RaiseFlow.applyDueRaises('worker_profile').catch(()=>{});

  const now = new Date();
  const monthStr = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10)).slice(0,7); // Manila YYYY-MM

  const [profilesSnap, payslipsSnap] = await Promise.all([
    db.collection('worker_profiles').orderBy('name').get().catch(()=>({docs:[]})),
    db.collection('payslips').where('payPeriodMonth','==',monthStr).get().catch(()=>({docs:[]}))
  ]);
  const profiles = profilesSnap.docs.map(d=>({id:d.id,...d.data()}));
  const payslips = payslipsSnap.docs.map(d=>({id:d.id,...d.data()}));
  const totalDisbursed = payslips.reduce((s,p)=>s+(p.netPay||0),0);

  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-label">Worker Profiles</div><div class="kpi-value">${profiles.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Payslips This Month</div><div class="kpi-value">${payslips.length}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Disbursed (${now.toLocaleString('en-PH',{month:'short'})})</div><div class="kpi-value" style="font-size:16px">₱${fmt(totalDisbursed)}</div></div>
    </div>
    <div id="hrp-trouble-panel"></div>
    ${isPriv?`<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      ${isPayPriv?`<button class="btn-secondary btn-sm" id="hrp-goto-accounts-btn" title="Create the login and the worker record together">${emojiIcon('🔑',16)} Create Worker Account</button>`:''}
      <button class="btn-secondary btn-sm" id="hrp-payslip-history-btn">${emojiIcon('📄',16)} All Payslips</button>
      <button class="btn-secondary btn-sm" id="hrp-raise-history-btn">${emojiIcon('💸',16)} Raise History</button>
      <button class="btn-secondary btn-sm" id="hrp-batch-id-btn">${emojiIcon('🪪',16)} Batch Print IDs</button>
      ${isPayPriv?`<button class="btn-secondary btn-sm" id="hrp-sync-dir-btn">↻ Sync Directory</button>`:''}
    </div>`:''}
    <div class="card">
      <div class="card-header"><h3>${emojiIcon('👷',20)} Worker Profiles</h3></div>
      <div class="card-body" style="padding:0">
        ${!profiles.length ? `<div class="empty-state" style="padding:30px"><div class="empty-icon">${emojiIcon('👷',44)}</div><p>No worker profiles yet. Add one to start generating payslips.</p></div>` :
        `<div class="table-wrap"><table class="data-table table-cards">
          <thead><tr><th>Name</th><th>Job Title</th><th>Dept</th><th>Type</th><th>Daily Rate</th><th>CA Balance</th><th>Payroll</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${profiles.map(p=>`<tr class="hrp-row">
              <td class="tc-name" style="font-weight:600">${escHtml(p.name||'—')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
              <td class="tc-detail" data-label="Job Title">${escHtml(p.jobTitle||'—')}</td>
              <td class="tc-detail" data-label="Dept"><span class="badge badge-blue">${escHtml(p.department||'—')}</span></td>
              <td class="tc-detail" data-label="Type"><span class="badge badge-purple">${escHtml(p.employmentType||'—')}</span></td>
              <td class="tc-net">₱${fmt(p.dailyRate||0)}</td>
              <td class="tc-detail" data-label="CA Balance">${p.caBalance>0?`<span style="color:var(--danger)">₱${fmt(p.caBalance)}</span>`:'<span style="color:var(--text-muted)">—</span>'}</td>
              <td class="tc-detail" data-label="Payroll"><span class="badge ${p.includeInPayroll!==false?'badge-green':'badge-gray'}">${p.includeInPayroll!==false?'Included':'Excluded'}</span></td>
              <td class="tc-detail" data-label="Status"><span class="badge ${p.status==='active'?'badge-green':'badge-gray'}">${p.status||'active'}</span></td>
              <td class="tc-actions" style="white-space:nowrap">
                ${isPayPriv?`<button class="btn-primary btn-sm hrp-gen-btn" data-id="${p.id}" style="margin-right:4px">${emojiIcon('📄',16)} Payslip</button>`:''}
                <button class="btn-secondary btn-sm hrp-id-btn" data-id="${p.id}" style="margin-right:4px">${emojiIcon('🪪',16)} ID</button>
                ${isPriv?`<button class="btn-secondary btn-sm hrp-kiosk-btn" data-id="${p.id}" title="Record today's time in/out" style="margin-right:4px">${emojiIcon('⏱',16)} Clock</button>`:''}
                ${isPayPriv?`<button class="btn-secondary btn-sm hrp-raise-btn" data-id="${p.id}" title="Give raise" style="margin-right:4px">${emojiIcon('💸',16)} Raise</button>`:''}
                <button class="btn-secondary btn-sm ep-wprofile-btn" data-id="${p.id}" data-name="${escHtml(p.name||'')}">${emojiIcon('🪪',16)} Profile</button>
                ${isPayPriv?`<button class="btn-secondary btn-sm hrp-edit-btn" data-id="${p.id}">${emojiIcon('✎',16)} Edit</button>`:''}
                ${isPriv?`<button class="btn-danger btn-sm hrp-del-btn" data-id="${p.id}" data-label="${escHtml(p.name||p.id.slice(-5))}" style="margin-left:4px" aria-label="Delete worker profile">${emojiIcon('trash-2',14)}</button>`:''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  // Card view (≤700px) — tap a worker row to reveal the full breakdown.
  container.querySelectorAll('tr.hrp-row').forEach(tr => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a')) return;
      tr.classList.toggle('tc-expanded');
    });
  });

  // Employee profile — the composed per-person view, reached by worker_profiles
  // docId because most Operations staff have no login and so no uid to key on.
  // Bound OUTSIDE the isPriv gate below: the button is rendered to every viewer
  // of this roster, so gating only the LISTENER would make it a dead control.
  container.querySelectorAll('.ep-wprofile-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.openEmployeeProfile) window.openEmployeeProfile({ workerId: btn.dataset.id, name: btn.dataset.name });
    });
  });

  // Add profile
  if (isPriv) {
    // Owner, 2026-08-10: "there shouldnt be add worker because this is done by hr".
    // The old "+ Add Worker Profile" here created a worker RECORD ONLY — no
    // login, no self-service Time In, and it could never be linked to an
    // account afterwards. So the payroll screen quietly minted a second, weaker
    // kind of worker, which is the opposite of the one-create-path the spec
    // calls for. Removed. This now sends you to the place that mints BOTH the
    // Firebase login (with a generated password) and the worker record in one
    // go — HR → Accounts & Logins → Create Worker Account.
    document.getElementById('hrp-goto-accounts-btn')?.addEventListener('click', () => {
      if (typeof window.openCreateWorkerModal === 'function') { window.openCreateWorkerModal(); return; }
      navigateTo('team');   // the screen it lives on, if this loads before dashboards.js
    });
    document.getElementById('hrp-payslip-history-btn')?.addEventListener('click', () => openPayslipHistory(currentUser, currentRole));
    document.getElementById('hrp-raise-history-btn')?.addEventListener('click', () => openRaiseHistory());
    document.getElementById('hrp-batch-id-btn')?.addEventListener('click', () => window.batchPrintWorkerIDs(profiles.filter(p=>p.status!=='inactive')));
    document.getElementById('hrp-sync-dir-btn')?.addEventListener('click', async ()=>{
      Notifs.showToast('Syncing worker directory…');
      try { const n = await window.syncWorkerDirectory(); Notifs.success(`Directory synced — ${n} workers.`); }
      catch(ex){ Notifs.showToast('Sync failed: '+(ex.message||ex.code),'error'); }
    });
    container.querySelectorAll('.hrp-id-btn').forEach(btn => {
      const profile = profiles.find(p=>p.id===btn.dataset.id);
      btn.addEventListener('click', () => window.openWorkerIDModal(profile, () => renderFinanceHRProfiles(container,currentUser,currentRole)));
    });

    container.querySelectorAll('.hrp-raise-btn').forEach(btn => {
      const profile = profiles.find(p=>p.id===btn.dataset.id);
      btn.addEventListener('click', () => {
        if (!profile) return;
        openSalaryRaiseModal({
          subjectType: 'worker_profile',
          subjectId:   profile.id,
          subjectName: profile.name || 'Worker',
          fieldLabel:  'Daily Rate',
          targetField: 'dailyRate',
          current:     profile.dailyRate || 0
        }, currentUser, () => renderFinanceHRProfiles(container,currentUser,currentRole));
      });
    });

    container.querySelectorAll('.hrp-edit-btn').forEach(btn => {
      const profile = profiles.find(p=>p.id===btn.dataset.id);
      btn.addEventListener('click', () => openHRProfileForm(profile, currentUser, currentRole, ()=>renderFinanceHRProfiles(container,currentUser,currentRole)));
    });
    container.querySelectorAll('.hrp-del-btn').forEach(btn => btn.addEventListener('click', () => {
      window.financeDelete({ collection:'worker_profiles', docId:btn.dataset.id, label:`worker profile "${btn.dataset.label}"`, onDone:()=>renderFinanceHRProfiles(container,currentUser,currentRole) });
    }));

    // v12 WS26 — HR kiosk: record today's time in/out for a worker_profile
    // (no Firebase Auth login required for factory staff; see attendance_worker collection).
    container.querySelectorAll('.hrp-kiosk-btn').forEach(btn => {
      const profile = profiles.find(p=>p.id===btn.dataset.id);
      btn.addEventListener('click', () => { if (profile) openWorkerKioskModal(profile, currentUser); });
    });

    // v14 HR remediation P1 — surface pending "trouble timing in" / attendance
    // override requests right here in the worker-attendance area (not just the
    // main Approvals tab), since HR reviewing worker_profiles is exactly who
    // needs to act on these. Best-effort/non-blocking.
    _loadHrTroublePanel(container, currentUser);
  }

  // Generate payslip
  container.querySelectorAll('.hrp-gen-btn').forEach(btn => {
    const profile = profiles.find(p=>p.id===btn.dataset.id);
    btn.addEventListener('click', () => openPayslipGenerator(profile, currentUser, currentRole));
  });
}

// ── v14 HR remediation P1 — supervisor-override / "trouble timing in" intake.
// `attendance_extensions` (grepped) already exists and is written by the
// Type-A regular-employee flow with the confirmed shape
// {uid, userName, date, status:'pending', requestedAt} — keyed
// `${uid}_${date}` (see js/app.js's tryUpgradeAttendanceOnNotifRead/
// approveAttendanceExtension/denyAttendanceExtension, and
// js/screens/dashboards.js's req-ext-btn handler). The worker-side agent's
// Type-B "trouble timing in" requests are ASSUMED to land in this SAME
// collection (no dedicated collection found anywhere in the codebase), so
// this renders every pending doc generically and works whether the row is a
// Type-A employee (uid) or a Type-B worker_profile (assumed workerId field —
// unconfirmed; reconcile with the worker-side agent's actual field name).
// Approve/Deny reuse the existing global window.approveAttendanceExtension/
// denyAttendanceExtension (js/app.js) so no approval logic is duplicated;
// they fall back to a raw status update if those globals are ever absent.
async function _loadHrTroublePanel(container, currentUser) {
  const panelEl = document.getElementById('hrp-trouble-panel');
  if (!panelEl) return;
  let snap;
  try {
    snap = await db.collection('attendance_extensions').where('status','==','pending').get();
  } catch (_) { panelEl.innerHTML = ''; return; }
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!rows.length) { panelEl.innerHTML = ''; return; }
  // DEAD-CONTROL FIX (2026-08-09): Approve/Deny write attendance_extensions,
  // whose rule is `allow update, delete: if isAuth() && isAdmin()` —
  // president/manager/secretary ONLY. This panel lives inside the Operations
  // Team roster, which the `finance` role and any Finance-department member
  // also reach, so both were being offered buttons the boundary refuses. The
  // queue itself is still worth showing them (read is `isAuth() && !isPartner()`),
  // so render it read-only with the reason stated instead of hiding it.
  const canAct = (typeof window.isAdminPriv === 'function') ? window.isAdminPriv() : true;
  panelEl.innerHTML = `
    <div class="card" style="margin-bottom:16px;border:1.5px solid var(--warning,#d97706)">
      <div class="card-header"><h3>${emojiIcon('🚧',20)} Trouble Timing In — Pending (${rows.length})</h3></div>
      <div class="card-body" style="padding:0">
        <div style="font-size:11px;color:var(--text-muted);padding:10px 12px 0">Includes both regular-employee attendance-extension requests and (once the worker-side flow ships) Type-B worker "trouble timing in" reports — same collection, unconfirmed field-name overlap. See code comment for the assumption.</div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Requester</th><th>Date</th><th>Reason / Note</th><th>Requested</th><th></th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td style="font-weight:600">${escHtml(r.userName || r.workerName || r.workerId || r.uid || r.id || '—')}</td>
            <td>${escHtml(r.date || '—')}</td>
            <td style="font-size:12px">${escHtml(r.reason || r.note || '—')}</td>
            <td style="font-size:11px;color:var(--text-muted)">${r.requestedAt?.toDate ? escHtml(r.requestedAt.toDate().toLocaleString('en-PH')) : '—'}</td>
            <td style="white-space:nowrap">
              ${canAct ? `<button class="btn-primary btn-sm hrp-trbl-approve" data-id="${escHtml(r.id)}" data-uid="${escHtml(r.uid||'')}" data-name="${escHtml(r.userName||r.workerName||'')}">Approve</button>
              <button class="btn-secondary btn-sm hrp-trbl-deny" data-id="${escHtml(r.id)}" data-uid="${escHtml(r.uid||'')}" data-name="${escHtml(r.userName||r.workerName||'')}" style="margin-left:4px">Deny</button>`
              : `<span style="font-size:11px;color:var(--text-muted)">President / Manager / Secretary approves</span>`}
            </td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [panelEl] });
  panelEl.querySelectorAll('.hrp-trbl-approve').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (typeof window.approveAttendanceExtension === 'function') {
        await window.approveAttendanceExtension(btn.dataset.id, btn.dataset.uid, btn.dataset.name);
      } else {
        await db.collection('attendance_extensions').doc(btn.dataset.id).update({ status:'approved', approvedBy: currentUser.uid, approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
      Notifs.success('Request approved.');
    } catch(e) { Notifs.showToast('Could not approve: '+(e.message||e),'error'); }
    _loadHrTroublePanel(container, currentUser);
  }));
  panelEl.querySelectorAll('.hrp-trbl-deny').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (typeof window.denyAttendanceExtension === 'function') {
        await window.denyAttendanceExtension(btn.dataset.id, btn.dataset.uid, btn.dataset.name);
      } else {
        await db.collection('attendance_extensions').doc(btn.dataset.id).update({ status:'denied', deniedBy: currentUser.uid, deniedAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
      Notifs.success('Request denied.');
    } catch(e) { Notifs.showToast('Could not deny: '+(e.message||e),'error'); }
    _loadHrTroublePanel(container, currentUser);
  }));
}

function openHRProfileForm(profile, currentUser, currentRole, onSave) {
  const isEdit = !!profile;
  const depts = ['Barro Kitchens','Barro Industries','Brilliant Steel','Finance','HR','Operations','General'];
  const empTypes = ['Regular','Part-time','Contractual','Project-based'];
  const workTypes = ['Onsite','Online','Hybrid','Remote'];
  // Statutory-config spec (2026-08-06) §5.1 — currently-saved statutory mode
  // per contribution type. An absent field, an absent key, or garbage all read
  // as 'default', which for Type B means EXACTLY today's behaviour: nothing is
  // computed and nothing is deducted (per the owner, production workers are not
  // yet regularised, so nothing is due). 'exempt' is the same zero — it just
  // records that the decision was made deliberately rather than never made.
  const _hrpScOf = (k) => (profile?.statConfig && ['auto','fixed','exempt'].includes(profile.statConfig[k])) ? profile.statConfig[k] : 'default';

  const _panel = openPage(`${isEdit?'Edit':'Add'} Worker Profile`, `
    <div class="form-row">
      <div class="form-group"><label>Full Name *</label><input id="hrp-name" value="${escHtml(profile?.name||'')}"/></div>
      <div class="form-group"><label>ID Number</label>
        <div style="display:flex;gap:6px">
          <input id="hrp-id" value="${escHtml(profile?.idNumber||'')}" style="flex:1" placeholder="BI-W-001"/>
          <button type="button" class="btn-secondary btn-sm" id="hrp-gen-id" title="Generate BI-W number">Generate</button>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label>ID Photo</label>
      <div style="display:flex;gap:12px;align-items:center">
        <div id="hrp-photo-prev" style="width:64px;height:78px;border:1px solid var(--border);border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--surface2);font-size:26px">
          ${profile?.photoUrl?`<img src="${escHtml(profile.photoUrl)}" style="width:100%;height:100%;object-fit:cover"/>`:`${emojiIcon('👤',16)}`}</div>
        <div><input type="file" id="hrp-photo-file" accept="image/*"/>
          <div id="hrp-photo-status" style="font-size:11px;color:var(--text-muted);margin-top:4px"></div></div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Job Title</label><input id="hrp-title" value="${escHtml(profile?.jobTitle||'')}"/></div>
      <div class="form-group"><label>Department</label><select id="hrp-dept">
        ${depts.map(d=>`<option value="${d}" ${profile?.department===d?'selected':''}>${d}</option>`).join('')}
        <option value="${escHtml(profile?.department||'')}" ${!depts.includes(profile?.department||'')?'selected':''}>Other</option>
      </select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Employment Type</label><select id="hrp-emptype">
        ${empTypes.map(t=>`<option value="${t}" ${profile?.employmentType===t?'selected':''}>${t}</option>`).join('')}
      </select></div>
      <div class="form-group"><label>Work Setup</label><select id="hrp-worktype">
        ${workTypes.map(t=>`<option value="${t}" ${profile?.workType===t?'selected':''}>${t}</option>`).join('')}
      </select></div>
    </div>
    <div class="form-row">
      ${isEdit ? `
      <div class="form-group"><label>Hourly Rate (₱)</label>
        <div style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2,var(--surface));color:var(--text-muted)">₱${fmt(profile?.hourlyRate||(profile?.dailyRate?profile.dailyRate/8:0))}</div>
      </div>
      <div class="form-group"><label>Daily Rate (₱)</label>
        <div style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2,var(--surface));color:var(--text-muted)">₱${fmt(profile?.dailyRate||0)} · <span style="font-size:11px">change via ${emojiIcon('💸',16)} Raise (approval-routed)</span></div>
      </div>` : `
      <div class="form-group"><label>Hourly Rate (₱) <span style="font-size:9px;color:var(--text-muted);font-weight:400">used to compute pay</span></label><input id="hrp-hourly" type="number" inputmode="decimal" step="0.01" value="0"/></div>
      <div class="form-group"><label>Daily Rate (₱) <span style="font-size:9px;color:var(--text-muted);font-weight:400">reference</span></label><input id="hrp-daily" type="number" inputmode="decimal" value="0"/></div>`}
    </div>
    <div class="form-row">
      <div class="form-group"><label>Food Allowance (₱) <span style="font-size:9px;color:var(--text-muted);font-weight:400">auto-added per day &gt;4 hrs</span></label><input id="hrp-food" type="number" inputmode="decimal" value="${profile?.foodAllowance||0}"/></div>
      <div class="form-group"><label>Issued On</label><input id="hrp-issued" type="date" value="${profile?.issuedOn||today()}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Transport Allowance</label><input id="hrp-transport" type="number" inputmode="decimal" value="${profile?.allowances?.transport||0}"/></div>
      <div class="form-group"><label>Meal Allowance <span style="font-size:9px;color:var(--text-muted);font-weight:400">fixed extra</span></label><input id="hrp-meal" type="number" inputmode="decimal" value="${profile?.allowances?.meal||0}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>SSS Number</label><input id="hrp-sss" value="${escHtml(profile?.ssNum||'')}"/></div>
      <div class="form-group"><label>PhilHealth</label><input id="hrp-ph" value="${escHtml(profile?.phNum||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Pag-IBIG</label><input id="hrp-pib" value="${escHtml(profile?.pagibigNum||'')}"/></div>
      <div class="form-group"><label>TIN</label><input id="hrp-tin" value="${escHtml(profile?.tinNum||'')}"/></div>
    </div>
    <div style="margin:4px 0 12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface2,var(--surface))">
      <label style="font-weight:600">Statutory Deductions (SSS / PhilHealth / Pag-IBIG / Tax)</label>
      <div style="font-size:11px;color:var(--text-muted);margin:4px 0 8px">
        Default: <strong>not deducted</strong> — today's behaviour for workers who are not yet
        regularised. When a worker regularises, switch each item to <strong>Auto</strong> (monthly table
        amount, deducted once a month on the month's last payslip) or <strong>Fixed</strong> (a set
        monthly ₱ amount, same once-a-month timing). Amounts stay editable on every payslip.
      </div>
      <div class="form-row">
        <div class="form-group"><label>SSS</label>
          <select id="hrp-stat-sss-mode">
            <option value="default" ${_hrpScOf('sss')==='default'?'selected':''}>Default — not deducted</option>
            <option value="auto" ${_hrpScOf('sss')==='auto'?'selected':''}>Auto — monthly table</option>
            <option value="fixed" ${_hrpScOf('sss')==='fixed'?'selected':''}>Fixed monthly ₱</option>
            <option value="exempt" ${_hrpScOf('sss')==='exempt'?'selected':''}>Exempt — confirmed not due</option>
          </select>
        </div>
        <div class="form-group"><label>Fixed ₱ (if Fixed)</label><input id="hrp-stat-sss-amt" type="number" inputmode="decimal" value="${profile?.sss||0}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>PhilHealth</label>
          <select id="hrp-stat-ph-mode">
            <option value="default" ${_hrpScOf('philhealth')==='default'?'selected':''}>Default — not deducted</option>
            <option value="auto" ${_hrpScOf('philhealth')==='auto'?'selected':''}>Auto — monthly table</option>
            <option value="fixed" ${_hrpScOf('philhealth')==='fixed'?'selected':''}>Fixed monthly ₱</option>
            <option value="exempt" ${_hrpScOf('philhealth')==='exempt'?'selected':''}>Exempt — confirmed not due</option>
          </select>
        </div>
        <div class="form-group"><label>Fixed ₱ (if Fixed)</label><input id="hrp-stat-ph-amt" type="number" inputmode="decimal" value="${profile?.philhealth||0}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Pag-IBIG</label>
          <select id="hrp-stat-pib-mode">
            <option value="default" ${_hrpScOf('pagibig')==='default'?'selected':''}>Default — not deducted</option>
            <option value="auto" ${_hrpScOf('pagibig')==='auto'?'selected':''}>Auto — monthly table</option>
            <option value="fixed" ${_hrpScOf('pagibig')==='fixed'?'selected':''}>Fixed monthly ₱</option>
            <option value="exempt" ${_hrpScOf('pagibig')==='exempt'?'selected':''}>Exempt — confirmed not due</option>
          </select>
        </div>
        <div class="form-group"><label>Fixed ₱ (if Fixed)</label><input id="hrp-stat-pib-amt" type="number" inputmode="decimal" value="${profile?.pagibig||0}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Tax</label>
          <select id="hrp-stat-tax-mode">
            <option value="default" ${_hrpScOf('tax')==='default'?'selected':''}>Default — not deducted</option>
            <option value="auto" ${_hrpScOf('tax')==='auto'?'selected':''}>Auto — monthly table</option>
            <option value="fixed" ${_hrpScOf('tax')==='fixed'?'selected':''}>Fixed monthly ₱</option>
            <option value="exempt" ${_hrpScOf('tax')==='exempt'?'selected':''}>Exempt — confirmed not due</option>
          </select>
        </div>
        <div class="form-group"><label>Fixed ₱ (if Fixed)</label><input id="hrp-stat-tax-amt" type="number" inputmode="decimal" value="${profile?.tax||0}"/></div>
      </div>
    </div>
    <div class="form-group"><label>Address</label><input id="hrp-addr" value="${escHtml(profile?.address||'')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Contact</label><input id="hrp-phone" value="${escHtml(profile?.phone||'')}"/></div>
      <div class="form-group"><label>Status</label><select id="hrp-status">
        <option value="active" ${profile?.status!=='inactive'?'selected':''}>Active</option>
        <option value="inactive" ${profile?.status==='inactive'?'selected':''}>Inactive</option>
      </select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Cash Advance Balance (₱)</label><input id="hrp-ca-balance" type="number" value="${profile?.caBalance||0}" inputmode="decimal"/></div>
      <!-- Include-in-Payroll. Two things were wrong here and both are fixed in place:
           (1) the inline width/height:18px was a workaround for the .form-group
               input{width:100%} bug, which is now carved out at source in
               css/styles.css (~345). The inline sizing OUTRANKED the carve-out and
               was one of three different checkbox sizes in the app; dropped, so the
               .check-row input[type=checkbox]{width:18px;height:18px} house rule
               (~386) sizes it like every other label-wrapped checkbox.
           (2) .form-group label paints labels as uppercase, muted, 11-12px field
               CAPTIONS. On a checkbox that decides whether a worker appears in the
               pay run at all, "INCLUDE IN PAYROLL" in muted micro-caps reads as a
               heading rather than a live option, so text-transform/colour/size are
               overridden back to ordinary option text. display:flex is stated inline
               rather than left to label.check-row because that class only beats
               .form-group label{display:block} on source order, and this control is
               not one to leave depending on which rule was written last. -->
      <div class="form-group" style="display:flex;align-items:center;padding-top:22px">
        <label class="check-row" style="display:flex;padding:4px 0;font-weight:600;font-size:13px;text-transform:none;letter-spacing:0;color:var(--text);margin-bottom:0">
          <input type="checkbox" id="hrp-include-payroll" ${profile?.includeInPayroll!==false?'checked':''}/>
          Include in Payroll
        </label>
      </div>
    </div>
    <div class="form-group">
      <label>Linked Login Account (uid) — optional</label>
      <input id="hrp-linked-uid" list="hrp-linked-uid-list" value="${escHtml(profile?.linkedUid||'')}" placeholder="Start typing a name or email to search, or paste a uid"/>
      <datalist id="hrp-linked-uid-list"></datalist>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">v14 Type-B self-service: set this if the worker is paid weekly here AND has a regular-staff login — the monthly payroll run hard-skips this uid to prevent double pay. Pick from the suggestions (matched by name/email) so the uid is never mistyped — it's re-checked on Save either way.</div>
    </div>
  `, `<button class="btn-primary" id="hrp-save-btn">${isEdit?'Update':'Save'} Profile</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  // ⚠ SCOPED TO THIS PANEL, NOT document.
  // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second
  // record inside that window and two panels carry the same element ids at
  // once — document.getElementById() returns the FIRST match in document
  // order, which is the DYING panel. At bind time the handler lands on a
  // button nobody can see (the visible one gets none); inside the handler
  // the field reads pull the PREVIOUS record's values and write them onto
  // THIS record. Corporate Secretary report, reproduced 2026-08-10.
  const $hrp = (id) => _panel.querySelector('#' + id);

  // Stable doc id (pre-allocate for new profiles so the photo path is known).
  const profileId = profile?.id || db.collection('worker_profiles').doc().id;
  let uploadedPhotoUrl = profile?.photoUrl || '';

  // ── Linked Login Account autocomplete — was a blind uid paste with no
  // lookup-by-name/email. Populate a <datalist> from the users cache so HR
  // picks a real account instead of typing a raw uid from memory. Purely a
  // suggestion UI (mobile datalist support varies) — the field stays a plain
  // text input, re-validated (existence + uniqueness) on Save below either way. ──
  (async () => {
    const listEl = $hrp('hrp-linked-uid-list');
    if (!listEl) return;
    try {
      const usersSnap = await window.dbCachedGet('users', () => db.collection('users').get());
      listEl.innerHTML = usersSnap.docs.map(d => {
        const u = d.data();
        const label = `${u.displayName || u.email || d.id}${u.email ? ' — ' + u.email : ''}`;
        return `<option value="${escHtml(d.id)}">${escHtml(label)}</option>`;
      }).join('');
    } catch (_) { /* best-effort — free-text uid entry still works without it */ }
  })();

  $hrp('hrp-gen-id')?.addEventListener('click', async () => {
    const btn = $hrp('hrp-gen-id'); btn.disabled = true; btn.textContent = '…';
    try { $hrp('hrp-id').value = await window.nextWorkerIdNumber(); }
    catch(e){ Notifs.showToast('Could not generate ID number','error'); }
    btn.disabled = false; btn.textContent = 'Generate';
  });

  $hrp('hrp-photo-file')?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const st = $hrp('hrp-photo-status'); st.textContent = 'Uploading…';
    try {
      uploadedPhotoUrl = await window.Drive.uploadWorkerPhoto(f, profileId);
      $hrp('hrp-photo-prev').innerHTML = `<img src="${escHtml(uploadedPhotoUrl)}" style="width:100%;height:100%;object-fit:cover"/>`;
      st.textContent = '✅ Photo uploaded';
    } catch(err){ st.textContent = '❌ ' + (err.message||'Upload failed'); }
  });

  $hrp('hrp-save-btn').addEventListener('click', async () => {
    // v14 re-audit fix — this doc carries dailyRate/hourlyRate, foodAllowance,
    // allowances.meal/transport and caBalance, so firestore.rules gates
    // worker_profiles create/update on isMoneyAdmin(). Re-check here rather
    // than trusting that the caller was rendered with isPayPriv: a stale panel
    // (or a role change mid-session) must not drive a write that would come
    // back as a bare permission error.
    if (typeof isMoneyPriv === 'function' && !isMoneyPriv()) {
      Notifs.showToast('Worker pay changes are President / Manager / Finance only.','error');
      return;
    }
    const name = $hrp('hrp-name').value.trim();
    if (!name) { Notifs.showToast('Name is required','error'); return; }
    const linkedUid = $hrp('hrp-linked-uid').value.trim();
    // ── Validate the Linked Login Account uid BEFORE writing — a copy/paste
    // mistake here used to either silently break the bridge (no existence
    // check) or, worse, link to a DIFFERENT real employee's account (no
    // uniqueness check), letting that unrelated person clock in/out and see
    // pay estimates under this worker's identity. Both reads are already
    // allowed by firestore.rules for finance/admin (users: any authed read;
    // worker_profiles: isFinanceOrAdmin() read), so no rules change needed. ──
    if (linkedUid) {
      const saveBtn = $hrp('hrp-save-btn');
      if (saveBtn) saveBtn.disabled = true;
      let userDoc;
      try {
        userDoc = await db.collection('users').doc(linkedUid).get();
      } catch (err) {
        if (saveBtn) saveBtn.disabled = false;
        Notifs.showToast('Could not verify Linked Login Account: ' + (err.message||err), 'error');
        return;
      }
      if (!userDoc.exists) {
        if (saveBtn) saveBtn.disabled = false;
        Notifs.showToast('No login account found with that uid — pick a suggestion or leave it blank.', 'error');
        return;
      }
      const dupeSnap = await db.collection('worker_profiles').where('linkedUid', '==', linkedUid).get().catch(() => ({ docs: [] }));
      const dupe = dupeSnap.docs.find(d => d.id !== profileId);
      if (dupe) {
        if (saveBtn) saveBtn.disabled = false;
        Notifs.showToast(`That login is already linked to worker profile "${dupe.data().name || dupe.id}" — each account can only link to one worker profile.`, 'error');
        return;
      }
      if (saveBtn) saveBtn.disabled = false;
    }
    // Statutory-config spec §5.1 — per-type mode chosen on this form.
    // 'default' means the key must be ABSENT on the doc so every reader takes
    // the no-config path (Type B: compute nothing, deduct nothing).
    const _wpModeOf = (elId) => { const v = $hrp(elId)?.value; return (v==='auto'||v==='fixed'||v==='exempt') ? v : 'default'; };
    const _wpModes  = { sss:_wpModeOf('hrp-stat-sss-mode'), philhealth:_wpModeOf('hrp-stat-ph-mode'), pagibig:_wpModeOf('hrp-stat-pib-mode'), tax:_wpModeOf('hrp-stat-tax-mode') };

    const data = {
      name,
      idNumber: $hrp('hrp-id').value.trim(),
      photoUrl: uploadedPhotoUrl || '',
      jobTitle: $hrp('hrp-title').value.trim(),
      department: $hrp('hrp-dept').value,
      employmentType: $hrp('hrp-emptype').value,
      workType: $hrp('hrp-worktype').value,
      // v12 WS23 — dailyRate/hourlyRate are read-only in edit mode (change via
      // 💸 Raise instead); the inputs don't exist in the DOM then, so omit them
      // from the write entirely rather than reading a null element.
      ...(isEdit ? {} : {
        dailyRate: parseFloat($hrp('hrp-daily').value)||0,
        hourlyRate: parseFloat($hrp('hrp-hourly').value)||0,
      }),
      foodAllowance: parseFloat($hrp('hrp-food').value)||0,
      issuedOn: $hrp('hrp-issued').value,
      allowances: {
        meal: parseFloat($hrp('hrp-meal').value)||0,
        transport: parseFloat($hrp('hrp-transport').value)||0,
      },
      ssNum: $hrp('hrp-sss').value.trim(),
      phNum: $hrp('hrp-ph').value.trim(),
      pagibigNum: $hrp('hrp-pib').value.trim(),
      tinNum: $hrp('hrp-tin').value.trim(),
      // Statutory-config spec §5.1 — modes (FieldValue.delete() = key absent =
      // today's default: nothing computed, nothing deducted) plus the flat
      // fixed AMOUNTS. The four numbers are inert on an unconfigured profile:
      // nothing reads them until that type's mode is 'fixed'. No name clash —
      // the government ID strings on this doc are ssNum/phNum/pagibigNum/tinNum.
      statConfig: (() => {
        const m = {};
        Object.keys(_wpModes).forEach(k => {
          m[k] = _wpModes[k] === 'default' ? firebase.firestore.FieldValue.delete() : _wpModes[k];
        });
        return m;
      })(),
      sss:        parseFloat($hrp('hrp-stat-sss-amt')?.value)||0,
      philhealth: parseFloat($hrp('hrp-stat-ph-amt')?.value)||0,
      pagibig:    parseFloat($hrp('hrp-stat-pib-amt')?.value)||0,
      tax:        parseFloat($hrp('hrp-stat-tax-amt')?.value)||0,
      address: $hrp('hrp-addr').value.trim(),
      phone: $hrp('hrp-phone').value.trim(),
      status: $hrp('hrp-status').value,
      caBalance: parseFloat($hrp('hrp-ca-balance').value)||0,
      includeInPayroll: $hrp('hrp-include-payroll').checked,
      linkedUid,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!isEdit) { data.createdAt = firebase.firestore.FieldValue.serverTimestamp(); data.createdBy = currentUser.uid; }
    await db.collection('worker_profiles').doc(profileId).set(data, { merge: true });
    // Statutory-config spec §5.1 — audit the MODE change only. Silent when
    // nothing changed, which is every save on an unconfigured worker.
    {
      const _before = (profile && profile.statConfig) || {};
      const _after  = {};
      Object.keys(_wpModes).forEach(k => { if (_wpModes[k] !== 'default') _after[k] = _wpModes[k]; });
      const _norm = (o) => ['sss','philhealth','pagibig','tax'].map(k => `${k}:${o[k]||'default'}`).join(',');
      if (_norm(_before) !== _norm(_after)) {
        window.logAudit && window.logAudit('statutory-config','worker_profiles',profileId,{ before:_before, after:_after });
      }
    }
    // v12 WS28 — keep the public-safe roster projection in step (name/title/dept/
    // status/photo ONLY — never rates/CA/gov IDs). Best-effort: a denied projection
    // write must not fail the profile save.
    db.collection('worker_directory').doc(profileId).set({
      name: data.name, idNumber: data.idNumber||'', jobTitle: data.jobTitle||'',
      department: data.department||'', status: data.status||'active',
      photoUrl: data.photoUrl||'', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true }).catch(()=>{});
    closeModal();
    Notifs.success(isEdit ? 'Profile updated!' : 'Worker profile created!');
    onSave();
  });
}

// ── v14 HR attendance-remediation helpers (buddy-punch deterrent) ──────────
// Shared by openWorkerKioskModal (single-day view) and openPayslipGenerator's
// "Load Kiosk Hours" review list. Field names mirror what js/screens/worker.js
// (Type-B self-service Time In/Out) actually writes to attendance_worker/
// {workerId}/records/{date}: inSelfieUrl/outSelfieUrl, inDistanceM/outDistanceM,
// inValid/outValid, timeIn/timeOut, hoursWorked. `inAccuracyM`/`outAccuracyM`
// and `needsReview` are read defensively (per the sibling worker-side agent's
// contract) — they may not exist on every record, or yet at all.
//
// "Server-verified" marker: reconciled — the recordAttendancePunch Cloud
// Function (functions/index.js) stamps `serverVerified: true` on every record
// it writes (a geofence+selfie server-verified self-service punch). HR-kiosk
// hand-entries (openWorkerKioskModal) never set it, so they show no verified
// badge — accurate, since those are manually entered, not location-proven.
function _hrAttSelfieThumb(url, label) {
  if (!url) return `<div style="width:44px;height:44px;border-radius:8px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text-muted);text-align:center;flex-shrink:0">no photo</div>`;
  return `<img src="${escHtml(url)}" alt="${escHtml(label)}" title="${escHtml(label)} — click to enlarge" class="hr-att-thumb" data-url="${escHtml(url)}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid var(--border);cursor:pointer;flex-shrink:0"/>`;
}
// Bind click-to-enlarge on every .hr-att-thumb under root — opens the
// full-resolution selfie in a new tab (safer than stacking a modal-over-modal,
// which would replace rather than layer on this app's single-overlay design).
function _hrBindAttThumbs(root) {
  (root || document).querySelectorAll('.hr-att-thumb').forEach(img => {
    img.addEventListener('click', () => { const u = img.dataset.url; if (u) window.open(u, '_blank', 'noopener'); });
  });
}
function _hrVerifiedBadge(rec) {
  if (rec.serverVerified === true)  return `<span class="badge badge-green" title="Confirmed server-side">${emojiIcon('✅',12)} Server-verified</span>`;
  if (rec.serverVerified === false) return `<span class="badge badge-orange" title="Flagged unverified server-side">${emojiIcon('⚠️',12)} Unverified</span>`;
  return `<span class="badge badge-gray" title="No server-verification field found on this record (TODO: reconcile field name)">Verification: n/a</span>`;
}
// One in/out punch's detail — selfie thumbnail + distance + GPS accuracy.
function _hrPunchDetail(rec, kind) {
  const time  = kind === 'in' ? rec.timeIn : rec.timeOut;
  const selfie= kind === 'in' ? rec.inSelfieUrl : rec.outSelfieUrl;
  const dist  = kind === 'in' ? rec.inDistanceM : rec.outDistanceM;
  const acc   = kind === 'in' ? rec.inAccuracyM : rec.outAccuracyM;
  const valid = kind === 'in' ? rec.inValid : rec.outValid;
  return `<div style="display:flex;gap:8px;align-items:center">
    ${_hrAttSelfieThumb(selfie, `Time ${kind==='in'?'In':'Out'} selfie`)}
    <div style="font-size:11px;line-height:1.5">
      <div style="font-weight:600">${kind==='in'?'In':'Out'} ${escHtml(time || '—')}${valid===false?` <span style="color:var(--danger)">(invalid)</span>`:''}</div>
      <div style="color:var(--text-muted)">${dist!=null ? `${escHtml(String(dist))}m from site` : 'no distance on file'}</div>
      ${acc!=null ? `<div style="color:var(--text-muted)">±${escHtml(String(acc))}m GPS accuracy</div>` : ''}
    </div>
  </div>`;
}

// v12 WS26 — HR-operated kiosk: record a worker_profile's time in/out for today.
// Writes attendance_worker/{profileId}/records/{bizDate()} (NOT attendance/{uid} —
// factory worker_profiles have no Firebase Auth login yet). Reuses the existing
// computeDayHours(timeIn,timeOut) helper (same one the payslip time-log uses) so
// the hours math never drifts between kiosk entry and manual payslip entry.
function openWorkerKioskModal(profile, currentUser) {
  const label = escHtml(profile.name || 'Worker');
  openModal(`${emojiIcon('⏱',16)} Clock — ${label}`, `
    <div id="kiosk-existing-rec"></div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Recording time for <strong>${label}</strong> on ${bizDate()}.</div>
    <div class="form-row">
      <div class="form-group"><label>Time In</label><input id="kiosk-time-in" type="time" value="07:00"/></div>
      <div class="form-group"><label>Time Out</label><input id="kiosk-time-out" type="time" value="16:00"/></div>
    </div>
  `, `<button class="btn-primary" id="kiosk-save-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  // P1 buddy-punch deterrent — if a record already exists for today (e.g. the
  // worker already self-clocked via the Type-B geofenced flow, or a previous
  // HR entry), show its selfie/distance/accuracy BEFORE HR blindly clicks
  // Save below (which would silently overwrite it). Best-effort/read-only —
  // never blocks the entry form from working.
  (async () => {
    const el = document.getElementById('kiosk-existing-rec');
    if (!el) return;
    try {
      const snap = await db.collection('attendance_worker').doc(profile.id).collection('records').doc(bizDate()).get();
      if (!snap.exists) return;
      const rec = snap.data();
      if (!rec.timeIn && !rec.timeOut) return;
      el.innerHTML = `
        <div style="border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--surface2);margin-bottom:12px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Today's Record on File</div>
          ${rec.needsReview===true ? `<div style="font-size:11px;color:var(--danger);margin-bottom:6px">${emojiIcon('⚠️',12)} Flagged for review — confirm actual hours with the worker before overwriting.</div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:8px">
            ${_hrPunchDetail(rec, 'in')}
            ${rec.timeOut ? _hrPunchDetail(rec, 'out') : ''}
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${typeof rec.hoursWorked === 'number' ? `<span style="font-size:11px;color:var(--text-muted)">${rec.hoursWorked.toFixed(2)}h logged</span>` : ''}
            ${_hrVerifiedBadge(rec)}
          </div>
        </div>`;
      _hrBindAttThumbs(el);
    } catch (_) { /* best-effort — modal still works for a fresh entry */ }
  })();

  document.getElementById('kiosk-save-btn').addEventListener('click', async () => {
    const timeIn  = document.getElementById('kiosk-time-in').value;
    const timeOut = document.getElementById('kiosk-time-out').value;
    if (!timeIn || !timeOut) { Notifs.showToast('Time In and Time Out are required','error'); return; }
    const hrs = computeDayHours(timeIn, timeOut);
    await db.collection('attendance_worker').doc(profile.id).collection('records').doc(bizDate()).set({
      workerId: profile.id, date: bizDate(), timeIn, timeOut, hoursWorked: hrs,
      recordedBy: currentUser.uid, recordedByName: (window.userProfile && window.userProfile.displayName) || currentUser.email,
      recordedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    closeModal();
    Notifs.success(`Clocked ${label} — ${hrs.toFixed(1)}h logged.`);
  });
}

// ── Work Sites (geofencing admin) — Type-B self-service Time In/Out ────────
// CRUD over geo_sites/{id} = {name, lat, lng, radiusM, active}. Consumed by
// js/screens/worker.js's _handleClock (window.siteMatch, js/geo-core.js)
// on every Time In/Out attempt. No new CSS — reuses .card/.data-table/
// .form-group/.badge exactly like every other hr.js screen.
async function openWorkSitesPage(currentUser, currentRole) {
  // ⚠ 2026-08-09 — REGATED isFinancePriv() -> isOpsPriv(). Work Sites is the
  // geo_sites attendance-geofence admin: pure HR, and its boundary rule
  // (firestore.rules /geo_sites create,update) is isOpsAdmin(), NOT the money
  // tier. It rode isFinancePriv() only because it lives in hr.js. When the
  // Corporate Secretary lost isFinancePriv() in the Finance/IT carve-out, this
  // screen was the ONE true client-side lockout it would have caused: the rules
  // still allow them the write while the UI hides the button. Nothing errors, so
  // nobody notices — until a Type-B worker at a new gate cannot self-clock,
  // because a worker can only punch inside an ACTIVE site.
  const canEdit = (typeof window.isOpsPriv === 'function') ? window.isOpsPriv() : isFinancePriv();
  const _panel = openPage(`${emojiIcon('📍',16)} Work Sites`, `
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
      Type-B (Production) workers can only self-service Time In/Out within the radius of an <strong>active</strong> site below.
      Add every gate/floor a worker might clock in from.
    </p>
    <div id="ws-list">${window.skeletonHtml('rows')}</div>
    ${canEdit ? `<button class="btn-primary" id="ws-add-btn" style="width:100%;margin-top:12px">${emojiIcon('➕',16)} Add Work Site</button>` : ''}
  `, '', {});
  // ⚠ SCOPED TO THIS PANEL, NOT document.
  // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second
  // record inside that window and two panels carry the same element ids at
  // once — document.getElementById() returns the FIRST match in document
  // order, which is the DYING panel. At bind time the handler lands on a
  // button nobody can see (the visible one gets none); inside the handler
  // the field reads pull the PREVIOUS record's values and write them onto
  // THIS record. Corporate Secretary report, reproduced 2026-08-10.
  const $ws = (id) => _panel.querySelector('#' + id);

  async function load() {
    const snap = await db.collection('geo_sites').orderBy('name').get().catch(()=>({docs:[]}));
    const sites = snap.docs.map(d=>({id:d.id,...d.data()}));
    const listEl = $ws('ws-list');
    if (!listEl) return;
    listEl.innerHTML = !sites.length
      ? `<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('📍',44)}</div><p>No work sites yet. Add one to enable Type-B self-service Time In.</p></div>`
      : `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Name</th><th>Coordinates</th><th>Radius</th><th>Status</th>${canEdit?'<th></th>':''}</tr></thead>
          <tbody>${sites.map(s=>`<tr>
            <td style="font-weight:600">${escHtml(s.name||'—')}</td>
            <td style="font-size:12px"><code>${(Number(s.lat)||0).toFixed(6)}, ${(Number(s.lng)||0).toFixed(6)}</code></td>
            <td>${s.radiusM||0} m</td>
            <td><span class="badge ${s.active!==false?'badge-green':'badge-gray'}">${s.active!==false?'Active':'Inactive'}</span></td>
            ${canEdit?`<td style="white-space:nowrap">
              <button class="btn-secondary btn-sm ws-edit-btn" data-id="${s.id}" title="Edit" aria-label="Edit ${escHtml(s.name||'site')}">${emojiIcon('✎',14)}</button>
              <button class="btn-secondary btn-sm ws-toggle-btn" data-id="${s.id}" style="margin-left:4px">${s.active!==false?'Deactivate':'Activate'}</button>
            </td>`:''}
          </tr>`).join('')}</tbody>
        </table></div>`;
    if (window.lucide) lucide.createIcons({ nodes:[listEl] });
    if (!canEdit) return;
    listEl.querySelectorAll('.ws-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openWorkSiteForm(sites.find(s=>s.id===btn.dataset.id), currentUser, load));
    });
    listEl.querySelectorAll('.ws-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const s = sites.find(x=>x.id===btn.dataset.id);
        if (!s) return;
        btn.disabled = true;
        try {
          await db.collection('geo_sites').doc(s.id).update({ active: !(s.active!==false) });
          window.dbCacheInvalidate && window.dbCacheInvalidate('geo_sites-active'); // js/screens/worker.js's Time In/Out session cache
          Notifs.success(`${s.name||'Site'} ${s.active!==false?'deactivated':'activated'}.`);
        } catch (err) {
          Notifs.showToast('Could not update site: ' + (err.message||err), 'error');
        }
        load();
      });
    });
  }

  $ws('ws-add-btn')?.addEventListener('click', () => openWorkSiteForm(null, currentUser, load));
  load();
}

function openWorkSiteForm(site, currentUser, onSave) {
  const isEdit = !!site;
  openModal(`${isEdit?'Edit':'Add'} Work Site`, `
    <div class="form-group"><label>Site Name *</label><input id="ws-name" value="${escHtml(site?.name||'')}" placeholder="e.g. Carlatan Site"/></div>
    <div class="form-group"><label>Paste Coordinates <span style="font-size:9px;color:var(--text-muted);font-weight:400">paste "lat, lng" straight from Google Maps</span></label>
      <div style="display:flex;gap:6px">
        <input id="ws-paste" placeholder="16.6159, 120.3209" style="flex:1"/>
        <button type="button" class="btn-secondary btn-sm" id="ws-use-loc" style="white-space:nowrap">${emojiIcon('📍',14)} Use my location</button>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Latitude *</label><input id="ws-lat" type="number" step="any" value="${site?.lat??''}"/></div>
      <div class="form-group"><label>Longitude *</label><input id="ws-lng" type="number" step="any" value="${site?.lng??''}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Radius (meters)</label><input id="ws-radius" type="number" min="10" step="1" value="${site?.radiusM||150}"/></div>
      <!-- Same treatment as hrp-include-payroll above: the inline 18px sizing is
           dropped (the css/styles.css carve-out + .check-row now size it), the label
           gets the 44px .check-row tap wrap, and .form-group label's uppercase/muted
           caption styling is overridden so "Active" reads as the option it is. -->
      <div class="form-group" style="display:flex;align-items:center;padding-top:22px">
        <label class="check-row" style="display:flex;padding:4px 0;font-weight:600;font-size:13px;text-transform:none;letter-spacing:0;color:var(--text);margin-bottom:0">
          <input type="checkbox" id="ws-active" ${site?.active!==false?'checked':''}/> Active
        </label>
      </div>
    </div>
    <div id="ws-status" style="font-size:11px;color:var(--text-muted);min-height:14px"></div>
  `, `<button class="btn-primary" id="ws-save-btn">${isEdit?'Update':'Save'} Site</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  document.getElementById('ws-paste')?.addEventListener('input', (e) => {
    const parts = e.target.value.split(',').map(s=>s.trim()).filter(Boolean);
    if (parts.length === 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]))) {
      document.getElementById('ws-lat').value = parseFloat(parts[0]);
      document.getElementById('ws-lng').value = parseFloat(parts[1]);
    }
  });

  document.getElementById('ws-use-loc')?.addEventListener('click', () => {
    const btn = document.getElementById('ws-use-loc');
    const status = document.getElementById('ws-status');
    if (!navigator.geolocation) { if (status) status.textContent = 'Geolocation not supported on this device/browser.'; return; }
    btn.disabled = true;
    if (status) status.textContent = 'Getting your current location — stand at the site first…';
    navigator.geolocation.getCurrentPosition(pos => {
      document.getElementById('ws-lat').value = pos.coords.latitude;
      document.getElementById('ws-lng').value = pos.coords.longitude;
      if (status) status.textContent = `Location captured (±${Math.round(pos.coords.accuracy||0)}m accuracy).`;
      btn.disabled = false;
    }, err => {
      if (status) status.textContent = 'Could not get location: ' + (err.message || 'permission denied or unavailable.');
      btn.disabled = false;
    }, { enableHighAccuracy:true, timeout:10000, maximumAge:0 });
  });

  document.getElementById('ws-save-btn').addEventListener('click', () => window.busy(document.getElementById('ws-save-btn'), async () => {
    const name = document.getElementById('ws-name').value.trim();
    const lat = parseFloat(document.getElementById('ws-lat').value);
    const lng = parseFloat(document.getElementById('ws-lng').value);
    const radiusM = parseFloat(document.getElementById('ws-radius').value);
    const active = document.getElementById('ws-active').checked;
    if (!name) { Notifs.showToast('Site name is required','error'); return; }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { Notifs.showToast('Valid latitude and longitude are required','error'); return; }
    // A blank/zero/negative radius used to silently fall back to 150 only
    // when parseFloat was falsy — a typed "-50" parses to a real negative
    // number and saved as-is, and since geo-core.js's siteMatch requires
    // distanceM (always >= 0) <= radiusM, a negative radius can NEVER match,
    // silently making the site permanently unusable with no error shown.
    if (!Number.isFinite(radiusM) || radiusM <= 0) { Notifs.showToast('Radius must be a positive number of meters','error'); return; }
    const data = { name, lat, lng, radiusM, active, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: currentUser.uid };
    if (!isEdit) { data.createdAt = firebase.firestore.FieldValue.serverTimestamp(); data.createdBy = currentUser.uid; }
    const ref = site?.id ? db.collection('geo_sites').doc(site.id) : db.collection('geo_sites').doc();
    await ref.set(data, { merge:true });
    window.dbCacheInvalidate && window.dbCacheInvalidate('geo_sites-active'); // js/screens/worker.js's Time In/Out session cache
    closeModal();
    Notifs.success(isEdit ? 'Work site updated!' : 'Work site added!');
    onSave();
  }));
}

// Payslip workflow: draft → verified → filed → submitted (sequential, no skipping)
const PAYSLIP_STAGES = ['draft','verified','filed','submitted'];
function payslipStageBadge(status) {
  return { draft:'badge-gray', verified:'badge-blue', filed:'badge-orange', submitted:'badge-green' }[status] || 'badge-gray';
}

async function openPayslipHistory(currentUser, currentRole) {
  const canAct = ['president','owner','manager','finance'].includes(currentRole);
  // ── WINDOW FIRST, DATA SECOND (v14.0.71) ────────────────────────────────
  // The 100-doc payslips read used to gate the whole screen: openPage only ran
  // once renderModal() was reached, i.e. after the await. The shell below is
  // pushed synchronously in the tap handler instead, and renderModal's FIRST
  // paint fills that same element in place (see the note at the paint site for
  // why in-place rather than a second openPage).
  //
  // {replace:true} is carried over from renderModal's original call so the
  // page-stack depth is exactly what it always was: on the button path the
  // stack has no page on top and openPage falls back to a push, and on the
  // ps-edit onSave path Overlay.clearAll() has already emptied it.
  const shell = openPage(`${emojiIcon('📄',16)} Payslip Summary`, window.skeletonHtml('table'), '', {replace:true});
  const shellBody = shell.querySelector('.page-panel-body');
  let firstPaint = true;
  let list = [];

  const renderRows = () => list.map(p=>{
    const status = p.status || 'draft';
    const stageIdx = PAYSLIP_STAGES.indexOf(status);
    const nextStage = PAYSLIP_STAGES[stageIdx+1];
    const nextLabel = { verified:`${emojiIcon('✓',16)} Verify`, filed:`${emojiIcon('📁',16)} File`, submitted:`${emojiIcon('📤',16)} Submit` }[nextStage];
    return `<tr>
      <td style="font-weight:600">${escHtml(p.workerName||'—')}</td>
      <td style="font-size:12px">${p.payPeriodStart||''} – ${p.payPeriodEnd||''}</td>
      <td><strong>₱${fmt(p.netPay||0)}</strong></td>
      <td><span class="badge ${payslipStageBadge(status)}">${status}</span></td>
      <td style="white-space:nowrap">
        <button class="btn-secondary btn-sm ps-view-btn" data-id="${p.id}" style="font-size:11px">View</button>
        ${canAct && nextStage ? `<button class="btn-success btn-sm ps-advance-btn" data-id="${p.id}" data-next="${nextStage}" style="font-size:11px;margin-left:4px">${nextLabel}</button>` : ''}
        ${canAct ? `<button class="btn-secondary btn-sm ps-edit-btn" data-id="${p.id}" style="font-size:11px;margin-left:4px" title="Edit amounts" aria-label="Edit payslip amounts">${emojiIcon('✎',11)}</button>` : ''}
        ${canAct && status!=='draft' ? `<button class="btn-secondary btn-sm ps-override-btn" data-id="${p.id}" style="font-size:11px;margin-left:4px" title="Manually set status" aria-label="Manually set payslip status">${emojiIcon('settings',14)}</button>` : ''}
        ${canAct ? `<button class="btn-danger btn-sm ps-del-btn" data-id="${p.id}" style="font-size:11px;margin-left:4px" title="Delete" aria-label="Delete payslip">${emojiIcon('trash-2',14)}</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  const renderModal = () => {
    const totalNet = list.reduce((s,p)=>s+(p.netPay||0),0);
    const filedCount = list.filter(p=>['filed','submitted'].includes(p.status)).length;
    const bodyHTML = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;font-size:12px;color:var(--text-muted)">
        <span><strong style="color:var(--text)">${list.length}</strong> payslips</span>
        <span><strong style="color:var(--text)">${filedCount}</strong> filed/submitted</span>
        <span>Total net pay: <strong style="color:var(--success)">₱${fmt(totalNet)}</strong></span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Worker</th><th>Period</th><th>Net Pay</th><th>Status</th><th></th></tr></thead>
          <tbody>${!list.length ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No payslips yet</td></tr>' : renderRows()}</tbody>
        </table>
      </div>
    `;
    // FIRST PAINT fills the shell opened at the top of this function IN PLACE
    // rather than opening a second window. That keeps the same panel element,
    // so focus-return on Back still targets the button that opened it (a
    // skeleton-then-replace would hand openPage a _trigger living inside the
    // panel it is about to destroy) and there is no second entrance animation.
    //
    // EVERY LATER PAINT is a self-refresh (advance/delete/override re-invoke
    // renderModal() in place, same top-of-stack) and keeps the original
    // {replace:true} swap. The edit sub-page (ps-edit-btn) does NOT come
    // back through here — see its own onSave callback below, which pops back via
    // Overlay.clearAll() instead so the stale hidden copy of this page isn't left
    // behind under the edit page.
    let panel;
    if (firstPaint) {
      // Closed mid-flight — bail rather than resurrect a dismissed window.
      if (!shell.isConnected) return;
      shellBody.innerHTML = bodyHTML;
      panel = shell;
      firstPaint = false;   // set only once the fill actually landed
    } else {
      panel = openPage(`${emojiIcon('📄',16)} Payslip Summary`, bodyHTML, '', {replace:true});
    }
    if (window.lucide) lucide.createIcons({ nodes: [panel] });
    bindRows(panel);
  };

  // `root` is the live panel — see the scoping note on openSalaryRaiseModal.
  // These .ps-* buttons live inside the panel; a document-wide lookup would
  // bind the DYING panel's copies during openPage's ~300ms teardown window.
  const bindRows = (root) => {
    root.querySelectorAll('.ps-view-btn').forEach(btn => {
      const ps = list.find(p=>p.id===btn.dataset.id);
      btn.addEventListener('click', async () => {
        if (!ps) return;
        const model = window.toPayslipModel(ps, 'weekly');
        model.ytd = await window.payslipYtdWeekly(ps.workerId, (ps.payPeriodStart||'').slice(0,4) || (window.bizYear?window.bizYear():new Date().getFullYear()));
        window.renderPayslipPage(model, () => window.renderPayrollHub(deptContainer(), currentUser, currentRole, 'B'));
      });
    });
    root.querySelectorAll('.ps-advance-btn').forEach(btn => onClickSafe(btn, async () => {
        const ps = list.find(p=>p.id===btn.dataset.id);
        const next = btn.dataset.next;
        if (!ps || !next) return;
        // Name the AMOUNT, not just the worker and the period (owner: "I just
        // want to see the total before submitting it"). Submit is the
        // ledger-posting transition — it books exactly this netPay to Payroll
        // Expense a few lines below — so the figure quoted here is the figure
        // that hits the books. Read straight off `ps`, the same object the
        // Ledger.upsertByRef call uses, so the two cannot disagree.
        const _psAmt = ps.netPay || 0;
        // A payslip the WEEKLY RUN produced was already booked to the ledger by
        // WeeklyRun.disburse — that press is what moved the money. Submitting it
        // here must therefore NOT post again, and must not promise to: the
        // ledger keys off `WPAY-{payslipId}` while the run books under its own
        // ref, so Ledger.upsertByRef's idempotence cannot save us — the two refs
        // simply differ and the expense lands twice. This is the same money bug
        // in the confirm text and in the write, so both branch on one answer.
        const _psFromRun = window.isRunGeneratedPayslip(ps);
        const _psAmtLine = next === 'submitted'
          ? (_psFromRun
              ? `<br/><br/>Net pay: <strong>₱${fmt(_psAmt)}</strong>. This came from the weekly pay run, which already posted it to the General Ledger — filing it here will NOT post it a second time.`
              : `<br/><br/>This posts <strong>₱${fmt(_psAmt)}</strong> to the General Ledger as Payroll Expense.`)
          : `<br/><br/>Net pay: <strong>₱${fmt(_psAmt)}</strong>.`;
        if (!(await confirmDialog({message:`Mark ${escHtml(ps.workerName||'')}'s payslip (${escHtml(ps.payPeriodStart||'')} – ${escHtml(ps.payPeriodEnd||'')}) as "${escHtml(next)}"?${_psAmtLine}`, html:true}))) return;
        const fieldPrefix = { verified:'verified', filed:'filed', submitted:'submitted' }[next];
        const payDate = ps.payDate || ps.payPeriodEnd || today();
        // Check the period BEFORE flipping status — Submit is the ledger-posting
        // transition, so a closed month must not leave the payslip stuck
        // 'submitted' with no matching ledger row (v12 WS12).
        if (next === 'submitted') await window.assertPeriodOpen(payDate);
        await db.collection('payslips').doc(ps.id).update({
          status: next,
          [`${fieldPrefix}By`]: currentUser.uid,
          [`${fieldPrefix}At`]: firebase.firestore.FieldValue.serverTimestamp()
        });
        // On Submit, post the payslip to the general ledger (Finance → Ledger)
        // — UNLESS the weekly run already did (see _psFromRun above).
        if (next === 'submitted' && _psFromRun) {
          Notifs.success('Submitted. Already posted to the General Ledger by the weekly pay run.');
        } else if (next === 'submitted') {
          const lref = `WPAY-${ps.id}`;
          // v12 WS36 — runs inside the payslips modal (no room for a second modal),
          // so auto-tag with the registry's default account. Mis-tagged/untagged
          // rows are correctable from the Bank Accounts drill-down's re-tag control.
          const _def  = (await window.BankAccounts.list()).find(a => a.isDefault) || null;
          const _acct = await window.BankAccounts.pick(_def && _def.id);
          const description = `Worker Payslip — ${ps.workerName||'?'} (${ps.payPeriodStart||''}–${ps.payPeriodEnd||''})`;
          await window.Ledger.upsertByRef(lref, () => ({
            ref: lref, date: payDate, kind: 'debit',
            accountType: 'expense', account: 'Payroll Expense', category: 'Payroll Expense',
            description, amount: ps.netPay || 0, source: 'Finance',
            extra: { ...window.BankAccounts.tag(_acct, 'out') }
          }));
          Notifs.success('Submitted & posted to General Ledger.');
        } else {
          Notifs.success(`Payslip marked as ${next}.`);
        }
        ps.status = next;
        renderModal();
    }));
    root.querySelectorAll('.ps-edit-btn').forEach(btn => onClickSafe(btn, () => {
        const ps = list.find(p=>p.id===btn.dataset.id);
        // openPayslipEdit pushes ON TOP of this summary page (a real drill-in,
        // not a self-refresh), so its onSave can't just call renderModal()
        // {replace:true} — that would only pop the edit page and leave THIS
        // page's now-stale earlier copy hidden underneath. clearAll() + a fresh
        // open collapses both back to one entry, mirroring the task-edit pattern.
        if (ps) openPayslipEdit(ps, currentUser, () => { window.Overlay.clearAll(); openPayslipHistory(currentUser, currentRole); });
    }));
    root.querySelectorAll('.ps-del-btn').forEach(btn => onClickSafe(btn, async () => {
        const ps = list.find(p=>p.id===btn.dataset.id);
        if (!ps) return;
        // President deletes immediately; finance staff file a request. The CA
        // reversal + linked ledger cleanup run centrally in financeDeleteCascade.
        const outcome = await window.financeDelete({
          collection:'payslips', docId:ps.id,
          label:`payslip — ${ps.workerName||'?'} (${ps.payPeriodStart||''} – ${ps.payPeriodEnd||''})`
        });
        if (outcome === 'deleted') {
          const idx = list.findIndex(p=>p.id===ps.id);
          if (idx>=0) list.splice(idx,1);
          renderModal();
        }
    }));
    root.querySelectorAll('.ps-override-btn').forEach(btn => onClickSafe(btn, async () => {
        const ps = list.find(p=>p.id===btn.dataset.id);
        if (!ps) return;
        const choice = await promptDialog({title:'Manual override', message:`Set status for ${escHtml(ps.workerName)}'s payslip.\nOptions: ${PAYSLIP_STAGES.join(', ')}`, value:ps.status||'draft', html:true});
        if (!choice || !PAYSLIP_STAGES.includes(choice)) { if (choice) Notifs.showToast('Invalid status','error'); return; }
        await db.collection('payslips').doc(ps.id).update({
          status: choice, overriddenBy: currentUser.uid, overriddenAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        ps.status = choice;
        Notifs.success(`Status manually set to "${choice}".`);
        renderModal();
    }));
  };

  // The read that used to gate this whole screen now runs with the window
  // already up. withLoadingAndError (js/ui-states.js) owns skeleton → await →
  // render → error-with-Retry against the shell's body. On failure its Retry
  // re-runs this exact call, and `firstPaint` is still true at that point (the
  // renderer never ran), so a successful retry still fills the shell in place
  // instead of opening a second window.
  await window.withLoadingAndError(shellBody, async () => {
    const snap = await db.collection('payslips').orderBy('createdAt','desc').limit(100).get().catch(()=>({docs:[]}));
    return snap.docs.map(d=>({id:d.id,...d.data()}));
  }, (data) => {
    if (!shell.isConnected) return;
    list = data;
    renderModal();
  }, { skeleton: 'table' });
}

// Compact edit of a filed payslip's amounts (recomputes net; keeps ledger in sync).
function openPayslipEdit(ps, currentUser, onSave) {
  const r = ps.regular||{}, ot = ps.overtime||{}, al = ps.allowances||{}, g = ps.deductions?.govt||{}, o = ps.deductions?.other||{};
  // ── Statutory-config spec — D5 (employer share on a hand-edited payslip) ──
  // Until this feature, weekly payslips ALWAYS stored `employerShare: null`
  // (v12 WS24 decision 3), so this panel rewriting deductions.govt.* and never
  // touching employerShare was harmless. A worker configured `auto` now gets a
  // real ER pair written by the generator — the table ER for the exact bracket
  // the table EE amount came from. Correcting the EE figure here (₱650 → ₱400)
  // while leaving ER at ₱1,300 persists, and PRINTS, an EE/ER pair that exists
  // on no SSS/PhilHealth/Pag-IBIG schedule.
  //
  // Of the three options (recompute ER, clear it, block the edit) this clears
  // it, because:
  //   • Recomputing is not possible here and would be a confident wrong number.
  //     The ER bracket was keyed on the worker's MONTH-to-date gross (spec §5.2
  //     rule A); this doc stores only the WEEK's grossPay, and the month's other
  //     payslips are not loaded. Re-bracketing on the weekly gross would land in
  //     a different, lower bracket. Worse, a hand-set EE amount is by definition
  //     off-table — there is no bracket it belongs to.
  //   • Blocking would take away finance's ability to correct a filed payslip,
  //     a live capability regression for a defect that only affects a display
  //     figure.
  //   • Clearing restores `employerShare: null` — the pre-existing, already
  //     understood state that every reader handles: buildPayslipHTML's erCell
  //     renders "—" and the BIR 1601-C worksheet falls back to its "computed
  //     manually" dagger. "We no longer know" is the honest answer, and it is
  //     also the true one, since the remittance for a hand-adjusted figure is a
  //     manual accountant computation either way (spec §10.5).
  // Only the three ER-bearing EE amounts trigger it — tax has no employer share,
  // and edits to hours/CA/loans/paid leave ER untouched.
  const _erNote = ps.employerShare ? `
    <div style="font-size:11px;color:var(--text-muted);margin:-4px 0 8px;line-height:1.5">
      This payslip carries a recorded employer share (SSS ₱${fmt(ps.employerShare.sss||0)} ·
      PhilHealth ₱${fmt(ps.employerShare.philhealth||0)} · Pag-IBIG ₱${fmt(ps.employerShare.pagibig||0)}).
      Changing SSS / PhilHealth / Pag-IBIG below <strong>clears it</strong> — a hand-set employee
      amount no longer matches any table bracket, so the employer share reverts to
      &ldquo;computed manually&rdquo; rather than printing a pair that cannot exist.
    </div>` : '';
  const _panel = openPage(`${emojiIcon('✎',16)} Edit Payslip — ${escHtml(ps.workerName||'')}`, `
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${ps.payPeriodStart||''} – ${ps.payPeriodEnd||''}</div>
    <div class="form-row">
      <div class="form-group"><label>Rate / HR (₱)</label><input id="pe-rph" type="number" step="0.01" value="${r.ratePerHr||0}" inputmode="decimal"/></div>
      <div class="form-group"><label>Hours Worked</label><input id="pe-hrs" type="number" step="0.01" value="${r.hrsWorked||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Overtime Pay (₱)</label><input id="pe-ot" type="number" value="${ot.total||0}" inputmode="decimal"/></div>
      <div class="form-group"><label>Allowances total (₱)</label><input id="pe-allow" type="number" value="${al.total||0}" inputmode="decimal"/></div>
    </div>
    ${_erNote}
    <div class="form-row">
      <div class="form-group"><label>SSS</label><input id="pe-sss" type="number" value="${g.sss||0}" inputmode="decimal"/></div>
      <div class="form-group"><label>PhilHealth</label><input id="pe-ph" type="number" value="${g.philhealth||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Pag-IBIG</label><input id="pe-pib" type="number" value="${g.pagibig||0}" inputmode="decimal"/></div>
      <div class="form-group"><label>Cash Advance</label><input id="pe-ca" type="number" value="${o.cashAdvance||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Other / Loans</label><input id="pe-loans" type="number" value="${o.loans||0}" inputmode="decimal"/></div>
      <div class="form-group"><label>Taxes</label><input id="pe-tax" type="number" value="${o.taxes||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-group"><label>Amount Already Paid (₱)</label><input id="pe-paid" type="number" value="${ps.paid||0}" inputmode="decimal"/></div>
    <div id="pe-net" style="text-align:right;font-weight:800;font-size:14px;margin-top:6px">Net: ₱${fmt(ps.netPay||0)}</div>
  `, `<button class="btn-primary" id="pe-save-btn">Save Changes</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  // ⚠ SCOPED TO THIS PANEL, NOT document.
  // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second
  // record inside that window and two panels carry the same element ids at
  // once — document.getElementById() returns the FIRST match in document
  // order, which is the DYING panel. At bind time the handler lands on a
  // button nobody can see (the visible one gets none); inside the handler
  // the field reads pull the PREVIOUS record's values and write them onto
  // THIS record. Corporate Secretary report, reproduced 2026-08-10.
  const $pe = (id) => _panel.querySelector('#' + id);

  const num = id => parseFloat($pe(id).value)||0;
  const recompute = () => {
    const gross = num('pe-rph')*num('pe-hrs') + num('pe-ot') + num('pe-allow');
    const ded = num('pe-sss')+num('pe-ph')+num('pe-pib')+num('pe-ca')+num('pe-loans')+num('pe-tax');
    $pe('pe-net').textContent = 'Net: ₱'+fmt(gross - ded - num('pe-paid'));
  };
  ['pe-rph','pe-hrs','pe-ot','pe-allow','pe-sss','pe-ph','pe-pib','pe-ca','pe-loans','pe-tax','pe-paid']
    .forEach(id => $pe(id).addEventListener('input', recompute));

  $pe('pe-save-btn').addEventListener('click', () => window.busy($pe('pe-save-btn'), async () => {
    const rph=num('pe-rph'), hrs=num('pe-hrs'), otT=num('pe-ot'), alT=num('pe-allow');
    const sss=num('pe-sss'), ph=num('pe-ph'), pib=num('pe-pib'), ca=num('pe-ca'), loans=num('pe-loans'), tax=num('pe-tax'), paid=num('pe-paid');
    const reg = parseFloat((rph*hrs).toFixed(2));
    const govTotal=sss+ph+pib, otherTotal=ca+loans+tax;
    const grossPay = reg+otT+alT, totalDeductions = govTotal+otherTotal;
    const totalPay = grossPay-totalDeductions, netPay = totalPay-paid;
    // D5 — see the rationale above _erNote. Drop a stored employer share the
    // moment one of its three paired employee amounts is actually moved; leave
    // it alone for a pure hours/CA/tax/paid correction.
    const _oldG = ps.deductions?.govt || {};
    const _clearEr = !!ps.employerShare && (
         Math.abs((_oldG.sss||0)        - sss) > 0.001
      || Math.abs((_oldG.philhealth||0) - ph)  > 0.001
      || Math.abs((_oldG.pagibig||0)    - pib) > 0.001);
    await db.collection('payslips').doc(ps.id).update({
      ...(_clearEr ? { employerShare: null } : {}),
      'regular.ratePerHr':rph, 'regular.hrsWorked':hrs, 'regular.dailyRate':parseFloat((rph*8).toFixed(2)), 'regular.total':reg,
      'overtime.total':otT, 'allowances.total':alT, 'allowances.meal':alT,
      'deductions.govt.sss':sss, 'deductions.govt.philhealth':ph, 'deductions.govt.pagibig':pib, 'deductions.govt.total':govTotal,
      'deductions.other.cashAdvance':ca, 'deductions.other.loans':loans, 'deductions.other.taxes':tax, 'deductions.other.total':otherTotal,
      grossPay, totalDeductions, totalPay, paid, netPay,
      editedBy: currentUser.uid, editedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Keep the general-ledger entry in sync if it was already posted.
    // v14 re-audit ROUND 3 — this is the LAST source-edit -> /ledger-mirror
    // rewrite in the repo outside resyncLedgerForSource, and the only one whose
    // failure was invisible. /payslips carries no period gate, /ledger's update
    // rule has been two-sided since round 1, so editing a payslip whose payDate
    // is in a CLOSED month commits the payslip and is DENIED on the ledger row
    // (measured on the emulator: payslip 6000, ledger 4800). The throw was an
    // unhandled rejection inside window.busy — no toast, no console error the
    // user would see, closeModal()/Notifs.success() below never reached, so the
    // modal just sat there while the books stopped matching the payslip.
    // ledgerMirrorFailed() is round 2's books-integrity reporter, added for
    // exactly this case ("a future source collection mirrored without its own
    // gate"); this call site was missed. DIAGNOSTIC ONLY — the real fix is a
    // period gate on /payslips update, which needs its own lockout pass over
    // the payslip lifecycle (draft -> submitted -> verified -> filed, worker
    // self-reads, HR identity patches) and is deliberately NOT done here.
    const lsnap = await db.collection('ledger').where('refNumber','==',`WPAY-${ps.id}`).limit(1).get().catch(()=>({docs:[]}));
    if (lsnap.docs.length) {
      try { await lsnap.docs[0].ref.update({ amount: netPay }); }
      catch (err) { window.ledgerMirrorFailed(err, 'payslips', ps.id); }
    }
    // Reconcile the worker's running CA balance for any change in the cash-advance
    // deduction. Creation deducted the original CA from caBalance, and delete reverses
    // whatever is current (financeDeleteCascade), so an edit that doesn't adjust by the
    // delta leaves the running balance permanently wrong.
    const _oldCa = ps.deductions?.other?.cashAdvance || 0;
    if (ca !== _oldCa && ps.workerId) {
      // v12 WS22 — routed through the shared, transaction-guarded service. A
      // negative delta here correctly INCREASES caBalance (deductWorker's
      // clamp only floors at 0, it never blocks restoring balance an edit gave back).
      await window.CashAdvance.deductWorker(ps.workerId, ca - _oldCa, { reason:'payslip-edit-reconcile', payslipId: ps.id }).catch(()=>{});
    }
    // Mutate the in-memory copy so the summary reflects changes immediately
    ps.regular   = {...(ps.regular||{}), ratePerHr:rph, hrsWorked:hrs, dailyRate:parseFloat((rph*8).toFixed(2)), total:reg};
    ps.overtime  = {...(ps.overtime||{}), total:otT};
    ps.allowances= {...(ps.allowances||{}), total:alT, meal:alT};
    ps.deductions= { govt:{sss,philhealth:ph,pagibig:pib,total:govTotal}, other:{cashAdvance:ca,loans,taxes:tax,total:otherTotal} };
    ps.grossPay=grossPay; ps.totalDeductions=totalDeductions; ps.totalPay=totalPay; ps.paid=paid; ps.netPay=netPay;
    if (_clearEr) ps.employerShare = null;   // D5 — in-memory copy must match the doc
    closeModal();
    Notifs.success(_clearEr
      ? 'Payslip updated — the recorded employer share was cleared because an employee statutory amount changed.'
      : 'Payslip updated.');
    onSave && onSave();
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// WEEKLY-RUN COLLISION GUARD (2026-08-11)
//
// TWO routes now emit a `payslips` doc for one Operations worker:
//   1. openPayslipGenerator below — ONE worker, an arbitrary period. Kept
//      deliberately (owner): off-cycle pay, final pay, an advance, a partial
//      week, and correcting a single line of a run.
//   2. window.WeeklyRun.disburse — the whole Monday–Sunday week, one press.
//
// Nothing structural keeps them apart. `payslips` docs are written with
// .add() (auto-id, see the save handler below and PAYSLIP_RUN_MARKER's note),
// so there is no natural key on (workerId, week) for Firestore to collide on:
// both routes will happily emit a doc for the same worker and the same week.
// That worker is then PAID TWICE — two net-pay figures, two ledger postings,
// and two cash-advance decrements — and nothing anywhere says so.
//
// The guard below is the generator's half: before it writes, it asks the pay
// week whether the run has already claimed this worker. The run's half (skip a
// worker who already has a hand-issued payslip covering the week) belongs in
// window.WeeklyRun.compute/disburse and is handed off, not duplicated here.

/**
 * Is this payslip one the weekly run produced?
 *
 * Exported because BOTH sides need one answer: hr.js reads it (below, and in
 * openPayslipHistory's Submit handler), and js/payroll-weekly.js must STAMP
 * it. The marker of record is `payWeekId` — the week's MONDAY date, exactly
 * the pay_weeks doc id (window.payWeekMondayOf). The other spellings are
 * accepted defensively so a marker that lands under a near-miss name still
 * reads as run-generated: the failure mode of a FALSE negative here is paying
 * or posting twice, so this errs toward "yes, the run owns it".
 */
window.isRunGeneratedPayslip = function (ps) {
  if (!ps) return false;
  return !!(ps.payWeekId || ps.weekId || ps.payRunId ||
            ps.source === 'weekly-run' || ps.generatedBy === 'weekly-run');
};

/**
 * Ask every pay week the period touches whether `workerId` is already paid.
 *
 * Returns { block, warn } — `block` is a hard refusal string (money has moved
 * or is moving), `warn` is a confirm-first string (a run exists for the week
 * and lists this worker, but has not been released yet).
 *
 * THROWS on a failed read, and the caller REFUSES THE SAVE on a throw. A
 * denied or flaky read must never be silently read as "no run exists" — that
 * is precisely the reading that pays someone twice. Same house rule as "a
 * denied read must never render as an empty list on a pay screen".
 */
async function _weeklyRunCollision(workerId, workerName, periodStart, periodEnd) {
  const out = { block: '', warn: '' };
  if (!workerId || !periodStart || typeof window.payWeekMondayOf !== 'function') return out;

  // A custom period may straddle more than one Monday–Sunday week, so walk
  // every week the period touches rather than assuming one. Capped at 6 so a
  // fat-fingered date (2026 → 2006) can't turn into a thousand reads.
  const weekIds = [];
  let cur = window.payWeekMondayOf(periodStart);
  const last = window.payWeekMondayOf(periodEnd || periodStart);
  for (let i = 0; i < 6 && cur && cur <= last; i++) {
    weekIds.push(cur);
    const d = new Date(cur + 'T12:00:00+08:00');
    d.setUTCDate(d.getUTCDate() + 7);
    cur = d.toISOString().slice(0, 10);
  }
  // Hitting the cap means the tail of the period went UNCHECKED. Recorded now,
  // APPENDED at the end (never assigned to out.warn here — that would occupy
  // the `if (!out.warn)` slot below and suppress a real collision message,
  // which is the more important of the two). The point of this function is
  // that "not checked" and "no collision" must not read as the same answer.
  // (A weekly payslip spanning >6 weeks is a typo, not a use case.)
  const truncated = !!(cur && cur <= last);

  // NO .catch(()=>null) anywhere in this loop — see the throws-on-read note.
  for (const weekId of weekIds) {
    const snap = await db.collection('pay_weeks').doc(weekId).get();
    if (!snap.exists) continue;                       // nobody has computed that week
    const w     = snap.data() || {};
    const state = w.state || 'draft';
    if (state === 'draft') continue;                  // nothing claimed yet

    // A line identifies its worker by workerId in the contract; id /
    // workerProfileId are read too so a naming near-miss in the engine can't
    // turn into a missed collision (false negative = double pay).
    const line = (Array.isArray(w.lines) ? w.lines : [])
      .find(l => l && (l.workerId === workerId || l.id === workerId || l.workerProfileId === workerId));
    if (!line) continue;

    // An exclusion is period-scoped and means "not paid by the run THIS week"
    // — which is exactly when a hand-issued payslip is the correct thing to do.
    const excl = w.excluded || {};
    if (excl && Object.prototype.hasOwnProperty.call(excl, workerId) && excl[workerId]) continue;

    // Both strings below land in confirmDialog({html:true}), a raw-innerHTML
    // sink — so every interpolated value is escaped, even the ones that look
    // like they can only be dates.
    const label = escHtml((window.WeeklyRun && typeof window.WeeklyRun.weekLabel === 'function')
      ? window.WeeklyRun.weekLabel(weekId) : weekId);
    const who = escHtml(workerName || 'this worker');
    const net = Number(line.netPay != null ? line.netPay : line.net) || 0;

    if (state === 'disbursing' || state === 'disbursed') {
      out.block = `The weekly pay run for ${label} has already paid ${who} ` +
                  `₱${fmt(net)}. Issuing this payslip would pay them twice for the same week. ` +
                  `If this is a correction, edit that payslip from All Payslips instead.`;
      return out;                                     // hard stop beats any later warning
    }
    if (!out.warn) {
      out.warn = `The weekly pay run for ${label} is "${escHtml(state)}" and already includes ` +
                 `${who} for ₱${fmt(net)}. Issuing this payslip as well will pay them TWICE ` +
                 `unless you remove them from that week first.`;
    }
  }

  // Second collision, same route twice: a hand-issued payslip already covering
  // this period. Reuses the (workerId, payPeriodStart) composite index
  // payslipYtdWeekly already relies on — no new index.
  const first = weekIds[0] || window.payWeekMondayOf(periodStart);
  const psSnap = await db.collection('payslips')
    .where('workerId', '==', workerId)
    .where('payPeriodStart', '>=', first)
    .where('payPeriodStart', '<=', (periodEnd || periodStart))
    .get();
  const dupes = psSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (dupes.length && !out.block) {
    const d0   = dupes[0];
    const via  = window.isRunGeneratedPayslip(d0) ? 'the weekly pay run' : 'hand';
    const more = dupes.length > 1 ? ` (and ${dupes.length - 1} more)` : '';
    const dupLine = `${escHtml(workerName || 'This worker')} already has a payslip issued by ${via} for ` +
                    `${escHtml(d0.payPeriodStart || '?')} – ${escHtml(d0.payPeriodEnd || '?')}${more}, ` +
                    `net ₱${fmt(d0.netPay || 0)}.`;
    out.warn = out.warn
      ? (out.warn + '<br/><br/>' + dupLine)
      : (dupLine + ' Issuing another will pay them twice.');
  }
  if (truncated && !out.block) {
    const t = 'This pay period covers more than six weeks, so only the first six were checked ' +
              'against the weekly pay runs. Confirm the dates before issuing.';
    out.warn = out.warn ? (out.warn + '<br/><br/>' + t) : t;
  }
  return out;
}

function openPayslipGenerator(profile, currentUser, currentRole) {
  // Weekly cycle: Mon–Sat, paid each Saturday — anchored to Manila business calendar.
  // (Raw new Date().getDay()/toISOString() lands on the wrong day for the first 8h of
  //  each Manila day and corrupted pay periods.)
  const todayISO = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
  const dow = window.bizDow ? window.bizDow() : new Date().getDay();   // 0 Sun .. 6 Sat (Manila)
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return window.bizDate ? window.bizDate(d) : d.toISOString().slice(0,10); };
  const periodEnd   = addDays(todayISO, (6 - dow + 7) % 7);  // upcoming/this Saturday
  const periodStart = addDays(periodEnd, -5);                // Monday of that pay week

  const panel = openPage(`${emojiIcon('📄',16)} Generate Payslip — ${escHtml(profile.name||'')}`, `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div class="form-group"><label>Pay Period Start</label><input id="ps-start" type="date" value="${periodStart}"/></div>
      <div class="form-group"><label>Pay Period End (Sat)</label><input id="ps-end" type="date" value="${periodEnd}"/></div>
      <div class="form-group"><label>Pay Date</label><input id="ps-date" type="date" value="${periodEnd}"/></div>
      <div class="form-group"><label>Business / Company Name</label><input id="ps-company" value="Barro Kitchens"/></div>
    </div>

    <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Daily Time Log</div>
        <div style="display:flex;align-items:center;gap:10px">
          <button type="button" class="btn-secondary btn-sm" id="ps-load-kiosk-btn">⟳ Load from kiosk</button>
          <span style="font-size:10px;color:var(--text-muted)">Auto-computes hours · −1hr lunch if shift spans 12–1PM</span>
        </div>
      </div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        <thead><tr>
          <th style="text-align:left;padding:4px">Day</th><th style="padding:4px">Time In</th><th style="padding:4px">Time Out</th><th style="padding:4px">Hours</th><th style="padding:4px" title="How this day's time was recorded: kiosk/self-service (location-backed) vs hand-keyed">Src</th>
        </tr></thead>
        <tbody>
          ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=>`<tr>
            <td style="padding:4px">${d}</td>
            <td style="padding:4px"><input id="ps-tin-${i}" type="time" class="ps-time-input" data-source="manual" value="${d==='Sun'?'':'07:00'}" style="width:100%;padding:4px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text)"/></td>
            <td style="padding:4px"><input id="ps-tout-${i}" type="time" class="ps-time-input" data-source="manual" value="${d==='Sun'?'':(d==='Sat'?'18:00':'16:00')}" style="width:100%;padding:4px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text)"/></td>
            <td style="padding:4px;text-align:center;font-weight:600" id="ps-dayhrs-${i}">0.00</td>
            <td style="padding:4px;text-align:center" id="ps-src-${i}">✏️</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;font-size:12px">
        Computed Total: <strong style="margin-left:6px" id="ps-computed-total">0.00</strong>&nbsp;hrs
      </div>
      <div id="ps-kiosk-review-area"></div>
      <div id="ps-kiosk-audit-area"></div>
    </div>

    <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Earnings</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:6px"><label>Rate/HR <span style="font-size:9px;color:var(--text-muted);font-weight:400">× hours = pay</span></label><input id="ps-rph" type="number" step="0.01" value="${(profile.hourlyRate||(profile.dailyRate/8)||0).toFixed ? (profile.hourlyRate||(profile.dailyRate/8)||0).toFixed(2) : profile.hourlyRate||0}" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:6px"><label>Daily Rate <span style="font-size:9px;color:var(--text-muted);font-weight:400">ref</span></label><input id="ps-daily" type="number" value="${profile.dailyRate||0}" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:6px">
          <label>Hours Worked <span style="font-size:9px;color:var(--text-muted);font-weight:400">(auto, editable)</span></label>
          <input id="ps-hrs" type="number" value="0" inputmode="decimal"/>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:6px"><label>OT Rate/HR <span style="font-size:9px;color:var(--text-muted);font-weight:400">(regular rate)</span></label><input id="ps-ot-rate" type="number" value="${(profile.dailyRate/8).toFixed(2)}" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:6px"><label>OT Hours</label><input id="ps-ot-hrs" type="number" value="0" inputmode="decimal"/></div>
        <div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:0"><label>Food Allow <span style="font-size:9px;color:var(--text-muted);font-weight:400">auto, &gt;4h/day</span></label><input id="ps-meal" type="number" value="${profile.allowances?.meal||0}" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:0"><label>Transport Allow</label><input id="ps-transport" type="number" value="${profile.allowances?.transport||0}" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:0"><label>Rent Allow</label><input id="ps-rent" type="number" value="0" inputmode="decimal"/></div>
      </div>
    </div>

    <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Deductions</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:6px"><label>SSS</label><input id="ps-sss" type="number" value="0" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:6px"><label>PhilHealth</label><input id="ps-ph" type="number" value="0" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:6px"><label>Pag-IBIG</label><input id="ps-pib" type="number" value="0" inputmode="decimal"/></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="form-group" style="margin-bottom:0">
          <label>Cash Advance Deduction</label>
          <input id="ps-ca" type="number" value="0" inputmode="decimal"/>
          <div style="font-size:10px;color:var(--text-muted);margin-top:3px">Balance: ₱<span id="ps-ca-balance-display">${fmt(profile.caBalance||0)}</span> · Remaining after deduction: ₱<span id="ps-ca-remaining-display" style="font-weight:700">${fmt(profile.caBalance||0)}</span></div>
        </div>
        <div class="form-group" style="margin-bottom:0"><label>Other Deduction (Loans, etc.)</label><input id="ps-loans" type="number" value="0" inputmode="decimal"/></div>
        <div class="form-group" style="margin-bottom:0"><label>Taxes</label><input id="ps-tax" type="number" value="0" inputmode="decimal"/></div>
      </div>
    </div>

    <div class="form-group">
      <label>Amount Already Paid (₱)</label><input id="ps-paid" type="number" value="0" inputmode="decimal"/>
    </div>
    <div class="form-group">
      <label>Prepared By</label><input id="ps-preparer" value="${escHtml(currentUser?.displayName||'')}"/>
    </div>
    <div class="form-group">
      <label>Attach Transfer Proof (optional)</label>
      <div id="ps-proof-area"></div>
    </div>

    <!-- Owner: "I just want to see the total before submitting it." Sticky to
         the bottom of the scrolling panel body so it stays next to the Save &
         Generate button in the (always-visible) panel foot, instead of hiding
         at the end of a long form. Every figure here is written by psSummary()
         from psFormInputs + psTotals — the SAME pair collectPayslipData saves
         with.
         OPAQUE, deliberately: --surface is a translucent overlay in every theme
         (measured rgba(255,255,255,.05)), and on a bar that FLOATS over the form
         while it scrolls that lets the fields underneath bleed through the
         figures. Painting the theme's opaque page background first and layering
         the usual --surface tint over it as a background-image gives the
         identical card look with nothing showing through, and stays
         theme-driven — both are the same tokens the cards above use. -->
    <div class="ps-live-total" style="position:sticky;bottom:0;background-color:var(--bg);background-image:linear-gradient(var(--surface),var(--surface));border:1.5px solid var(--border);border-radius:10px;padding:12px;margin-top:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">This payslip</div>
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:4px"><span>Gross pay</span><strong id="ps-sum-gross">₱0.00</strong></div>
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:4px"><span>Total deductions</span><strong id="ps-sum-ded" style="color:var(--danger)">₱0.00</strong></div>
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:8px"><span>Already paid</span><strong id="ps-sum-paid">₱0.00</strong></div>
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;border-top:1px solid var(--border);padding-top:8px">
        <span style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em">Net pay</span>
        <strong id="ps-sum-net" style="font-size:20px;color:var(--success)">₱0.00</strong>
      </div>
      <div id="ps-sum-basis" style="font-size:10px;color:var(--text-muted);margin-top:6px;line-height:1.5"></div>
    </div>
  `, `
    <button class="btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn-secondary" id="ps-preview-btn">${emojiIcon('👁',16)} Preview</button>
    <button class="btn-primary" id="ps-save-btn">${emojiIcon('💾',16)} Save &amp; Generate</button>
  `);
  // EVERY lookup below is scoped to THIS panel. #ps-* ids are not unique across
  // the page stack, and a buried or dying generator would win a document-wide
  // getElementById — the live total would then be read off a different form than
  // the one being saved, which is the one thing a pre-submit total must not do.
  const $ps = id => panel.querySelector('#' + id);

  // Bind proof upload area
  let proofFile = null;
  if (window.Drive?.renderUploadArea) {
    Drive.renderUploadArea('ps-proof-area', r => { proofFile = r; }, { label:'Upload transfer screenshot/photo', dept:'Finance', subfolder:'payslips' });
  }

  // ── Live money summary — the owner's "see the total before submitting it" ──
  // Reads the same inputs and runs the same arithmetic collectPayslipData uses
  // to build the doc that gets written (psFormInputs + psTotals), against THIS
  // panel — so #ps-sum-net is the netPay that will be saved to `payslips`, shown
  // on the printed payslip, and posted to the General Ledger on Submit. It is
  // not a second opinion about that number; there is only one expression.
  //
  // Three things move these figures and only one of them fires 'input':
  //   • typing in an amount field            → the listeners registered below
  //   • recomputeHours()                     → calls psSummary() itself (it also
  //     covers "Load from kiosk", whose last act is to call recomputeHours)
  //   • psStatRefresh / apply()              → calls psSummary() itself (it
  //     assigns SSS/PhilHealth/Pag-IBIG/tax programmatically — no event)
  const psSummary = () => {
    const v = psFormInputs(panel);
    const t = psTotals(v);
    const set = (id, txt) => { const el = $ps(id); if (el) el.textContent = txt; };
    // "-₱500.00", never "₱-500.00" — the sign belongs outside the symbol, and a
    // zero-hours week with a cash advance still on the books is a genuinely
    // negative net the owner must be able to read at a glance.
    const peso = n => (n < 0 ? '-₱' : '₱') + fmt(Math.abs(n));
    set('ps-sum-gross', peso(t.grossPay));
    set('ps-sum-ded',   (t.totalDeductions > 0 ? '-' : '') + peso(t.totalDeductions));
    set('ps-sum-paid',  (v.paid > 0 ? '-' : '') + peso(v.paid));
    set('ps-sum-net',   peso(t.netPay));
    const netEl = $ps('ps-sum-net');
    if (netEl) netEl.style.color = t.netPay >= 0 ? 'var(--success)' : 'var(--danger)';
    // textContent sinks throughout — plain text, figures only, no user-authored
    // string reaches any of them, so there is no innerHTML/escHtml sink here.
    set('ps-sum-basis',
      `${v.hrs.toFixed(2)} hrs × ₱${fmt(v.rph)} = ₱${fmt(t.regTotal)}`
      + ` · OT ₱${fmt(t.otTotal)} · allowances ₱${fmt(t.allowTotal)}`
      + ` · statutory ₱${fmt(t.govTotal)} · other ₱${fmt(t.otherTotal)}`);
  };

  // ── Auto-compute hours from daily time log (−1hr lunch if shift spans 12–1PM) ──
  let foodEdited = false, otHrsEdited = false;
  $ps('ps-meal')?.addEventListener('input', () => { foodEdited = true; });
  // v14: flag overtime automatically from days exceeding 8 hrs — this table
  // is fed by "Load Kiosk Hours" (self-service geofenced timeIn/timeOut),
  // which is uniquely well-positioned to surface OT without HR hand-typing
  // it. Only OT HOURS are auto-filled here — the OT RATE input (a pay policy
  // value) is left exactly as before, still manual/editable.
  $ps('ps-ot-hrs')?.addEventListener('input', () => { otHrsEdited = true; });
  // v14 HR remediation P2 — payslip provenance. Each ps-tin-{i} input carries a
  // data-source attribute: 'manual' (hand-keyed, the default), 'kiosk-manual'
  // (HR clocked it via openWorkerKioskModal — no GPS/selfie), or 'kiosk-verified'
  // (Type-B self-service, location + selfie backed). "Load Kiosk Hours" below
  // sets it programmatically (no 'input' event fires); a genuine user edit of
  // the field fires 'input' and resets it back to 'manual' via the listener
  // registered alongside recomputeHours, below — so the badge never lies about
  // a row HR has since hand-adjusted.
  const _srcLabel = (src) => src==='kiosk-verified'
      ? `<span title="Kiosk — self-service, location + selfie verified">${emojiIcon('📍',12)}</span>`
    : src==='kiosk-manual'
      ? `<span title="Kiosk — HR-entered, no GPS/selfie">${emojiIcon('🏷',12)}</span>`
      : `<span title="Hand-keyed by HR">✏️</span>`;
  const updateSourceBadges = () => {
    for (let i = 0; i < 7; i++) {
      const cell = $ps(`ps-src-${i}`);
      const inp = $ps(`ps-tin-${i}`);
      if (cell && inp) cell.innerHTML = _srcLabel(inp.dataset.source || 'manual');
    }
    if (window.lucide) lucide.createIcons();
  };
  // ── Statutory-config spec — D1 (the "Load from kiosk" under-deduction) ────
  // The statutory prefill below can only listen for 'input' events, and NOTHING
  // in this modal that moves gross programmatically fires one: "Load from
  // kiosk" assigns ps-tin-*/ps-tout-* directly, and recomputeHours() then
  // assigns ps-hrs / ps-meal / ps-ot-hrs directly. Gross jumped a full week
  // while the auto statutory amounts stayed keyed to the pre-load gross —
  // under-deducting the worker, under-remitting the EE share, and leaving
  // ps-er-json stale. recomputeHours is the ONE funnel every programmatic gross
  // change already passes through (the kiosk button's last act is to call it),
  // so it is where the prefill gets re-run. The prefill assigns itself to this
  // hook once it has decided the worker is configured; for every unconfigured
  // worker it stays null and this is a dead branch.
  let psStatRefresh = null;
  const recomputeHours = () => {
    let total = 0, daysOver4 = 0, otHrsTotal = 0;
    for (let i = 0; i < 7; i++) {
      const hrs = computeDayHours(
        $ps(`ps-tin-${i}`)?.value,
        $ps(`ps-tout-${i}`)?.value
      );
      const cell = $ps(`ps-dayhrs-${i}`);
      if (cell) cell.textContent = hrs.toFixed(2);
      total += hrs;
      if (hrs > 4) daysOver4++;
      if (hrs > 8) otHrsTotal += (hrs - 8);
    }
    const totalEl = $ps('ps-computed-total');
    if (totalEl) totalEl.textContent = total.toFixed(2);
    const hrsInput = $ps('ps-hrs');
    if (hrsInput) hrsInput.value = total.toFixed(2);
    // Food allowance: profile rate × number of days exceeding 4 hrs (unless manually overridden)
    const foodInput = $ps('ps-meal');
    if (foodInput && !foodEdited) foodInput.value = ((profile.foodAllowance||0) * daysOver4).toFixed(2);
    // OT hours: sum of (hrs − 8) across days exceeding 8 hrs (unless manually overridden)
    const otHrsInput = $ps('ps-ot-hrs');
    if (otHrsInput && !otHrsEdited) otHrsInput.value = otHrsTotal.toFixed(2);
    updateSourceBadges();
    // D1 — ps-hrs / ps-meal / ps-ot-hrs were just written programmatically, so
    // no 'input' event will reach the statutory prefill. Re-run it here (async,
    // internally sequenced) so the auto amounts always track the gross that is
    // actually on the form. Null for every worker without a statConfig.
    if (psStatRefresh) psStatRefresh();
    // Hours (and with them food allowance / OT hours) just moved, so the pesos
    // did too. psStatRefresh above is async and re-runs psSummary() itself once
    // the statutory amounts settle.
    psSummary();
  };
  panel.querySelectorAll('.ps-time-input').forEach(inp => {
    inp.addEventListener('input', recomputeHours);
    inp.addEventListener('input', () => { inp.dataset.source = 'manual'; });
  });
  recomputeHours();

  // Every amount input that moves the summary. (ps-hrs / ps-ot-hrs / ps-meal are
  // listed because HR may override them BY HAND, which fires 'input' and does
  // not go through recomputeHours — the same reason the statutory prefill binds
  // them below.) ps-daily is deliberately absent: it is a reference figure and
  // does not enter the math, exactly as in collectPayslipData.
  ['ps-rph','ps-hrs','ps-ot-rate','ps-ot-hrs','ps-meal','ps-transport','ps-rent',
   'ps-sss','ps-ph','ps-pib','ps-ca','ps-loans','ps-tax','ps-paid']
    .forEach(id => $ps(id)?.addEventListener('input', psSummary));
  psSummary();

  // ── Statutory-config spec (2026-08-06) §5.3 — OPT-IN Type B prefill ────
  // THE DEFAULT IS UNCHANGED AND ZERO. Per the owner, production workers are
  // not yet regularised, so SSS/PhilHealth/Pag-IBIG/tax are genuinely NOT DUE
  // for them and the zeros this form has always rendered are CORRECT. With no
  // `statConfig` on the worker_profiles doc — every worker on record today —
  // the guard at the top of the block below returns immediately: no Firestore
  // read, no listener, no hint, no hidden input, no DOM touch of any kind. The
  // deduction fields keep the literal value="0" from the markup above and
  // collectPayslipData reads exactly what it read yesterday. Nothing past that
  // guard can run for an unconfigured worker.
  //
  // Cadence (spec §5.2, rule A — the owner confirms this with his accountant
  // BEFORE the first worker is switched to auto/fixed): SSS/PhilHealth/Pag-IBIG
  // are MONTHLY obligations with monthly brackets, so a configured worker is
  // deducted the FULL MONTHLY amount ONCE — on the month's last weekly payslip
  // — with the bracket keyed on the month's real gross (already-saved payslips
  // for the month + this form's gross). Every field stays editable (the owner's
  // "allow to edit"); a manual edit pins that field for the rest of the
  // session, mirroring the foodEdited/otHrsEdited pattern above.
  (async () => {
    const cfg    = profile && profile.statConfig;
    const MODES  = ['auto','fixed','exempt'];
    const FIELDS = [['sss','ps-sss'],['philhealth','ps-ph'],['pagibig','ps-pib'],['tax','ps-tax']];
    // UNCONFIGURED — byte-identical to today. Also covers an empty map and a
    // map holding only unrecognised values.
    if (!cfg || typeof cfg !== 'object') return;
    if (!FIELDS.some(([k]) => MODES.includes(cfg[k]))) return;

    // 'exempt' is a one-time, unchanging state: zero, locked, labelled.
    FIELDS.forEach(([k, id]) => {
      if (cfg[k] !== 'exempt') return;
      const inp = $ps(id);
      if (!inp) return;
      inp.value = '0';
      inp.disabled = true;
      inp.style.opacity = '0.55';
      inp.title = 'Exempt — configured on the worker profile';
    });

    // auto/fixed only from here down.
    const AUTOFIX = FIELDS.filter(([k]) => cfg[k] === 'auto' || cfg[k] === 'fixed');
    if (!AUTOFIX.length) return;

    // Manual-edit pins — once HR types in a field, this block stops writing to
    // it for the rest of the session.
    const edited = {};
    AUTOFIX.forEach(([k, id]) => $ps(id)?.addEventListener('input', () => { edited[k] = true; }));

    // Hint line + hidden ER carrier, appended to the Deductions card. Both are
    // created here (never in the base markup) so an unconfigured worker's DOM
    // is untouched. If the card cannot be located the block degrades to
    // prefill-only and employerShare stays null exactly as before.
    const dedCard = $ps('ps-tax')?.closest('.form-group')?.parentElement?.parentElement;
    let hintEl = null, erInput = null;
    if (dedCard) {
      hintEl = document.createElement('div');
      hintEl.id = 'ps-stat-hint';
      hintEl.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:10px;line-height:1.5';
      dedCard.appendChild(hintEl);
      erInput = document.createElement('input');
      erInput.type = 'hidden';
      erInput.id = 'ps-er-json';
      dedCard.appendChild(erInput);
    }

    // Month-to-date gross: this worker's already-saved payslips whose period
    // starts inside THIS FORM'S START MONTH and STRICTLY BEFORE this form's own
    // period start. Reuses the existing composite index (workerId ASC,
    // payPeriodStart ASC) — no new index. Cached per start so retyping an
    // amount is free.
    //
    // D3 — the upper bound used to be the period END (Saturday), which the spec
    // (§5.3(2)) prescribed verbatim. THE SPEC WAS WRONG. A payslip already saved
    // for the SAME week has payPeriodStart = that week's Monday, which is < the
    // Saturday end — so re-opening the generator for a week that was already
    // filed (to fix a typo) counted that week's gross in mtdGross AND added the
    // form's own gross on top: a worker with four ₱3,000 weeks filed showed a
    // ₱15,000 month instead of ₱12,000, jumping an SSS bracket and
    // OVER-deducting. The form's own ps-start is the correct exclusive bound:
    // it counts every EARLIER payslip of the month exactly once and can never
    // count this period twice, whether it is a fresh draft or a regeneration.
    const mtdCache = {};
    const loadMtd = async (start) => {
      // D7 — BOTH bounds now live in ps-start space, the SAME field the query
      // filters on. The floor used to be derived from the period END while the
      // ceiling was ps-start, so a week straddling a month boundary
      // (Mon 2026-08-31 → Sat 09-05) sat BELOW September's floor and AT/ABOVE
      // August's exclusive ceiling: counted in NEITHER month. 8 of the 12 months
      // of 2026 mis-bracket that way (Jan, Apr, May, Jul, Aug, Sep, Oct, Dec).
      // With one field on both ends, consecutive Mon–Sat weeks tile the year:
      // every week is counted in exactly one month, never twice.
      // start >= monthStart by construction, so the range can never invert; a
      // week that starts ON the 1st gives an empty range = ₱0 to date, correct.
      const monthStart = start.slice(0,7) + '-01';
      if (start in mtdCache) return mtdCache[start];
      const snap = await db.collection('payslips')
        .where('workerId','==',profile.id)
        .where('payPeriodStart','>=', monthStart)
        .where('payPeriodStart','<', start)
        .get().catch(()=>({docs:[]}));
      mtdCache[start] = { gross: snap.docs.reduce((s,d)=>s+(d.data().grossPay||0),0), count: snap.docs.length };
      return mtdCache[start];
    };

    // Same gross expression collectPayslipData uses (rate×hrs + OT + allowances).
    const formGross = () => {
      const n = (id) => parseFloat($ps(id)?.value)||0;
      return n('ps-rph')*n('ps-hrs') + n('ps-ot-rate')*n('ps-ot-hrs') + n('ps-meal') + n('ps-transport') + n('ps-rent');
    };

    let seq = 0;
    const apply = async () => {
      const my    = ++seq;
      const end   = $ps('ps-end')?.value || '';
      const start = $ps('ps-start')?.value || '';
      // D3 — ps-start is now load-bearing (it bounds the month-to-date query),
      // so it is validated exactly as strictly as ps-end. A half-typed date
      // leaves the previous, still-correct amounts standing rather than
      // silently recomputing against a bogus period.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return;
      const mtd = await loadMtd(start);
      if (my !== seq) return;                       // a later edit already superseded this pass
      // ── BUSINESS RULE (D7), stated explicitly because it decides WHICH MONTH
      // a contribution is remitted in — FLAG FOR THE ACCOUNTANT before the first
      // worker is switched to auto/fixed:
      //   A pay week belongs to the month its START (Monday) falls in.
      // So Mon 2026-08-31 → Sat 09-05 is an AUGUST week, not a September one.
      // This is the only choice consistent with the query field: `payslips` are
      // bracketed by payPeriodStart (the composite index this screen reuses) and
      // payslipYtdWeekly already ranges the YEAR on payPeriodStart too. Deriving
      // the month floor from the start and the last-week test from the END mixed
      // the two spaces and lost whole weeks (see loadMtd). Everything below is in
      // start-space.
      // Last pay week of the month = the NEXT week's start lands in a different
      // month. Since starts step by exactly 7 days, each month has exactly one.
      // Pure — reuses this function's own addDays.
      const isLastPayWeek = addDays(start, 7).slice(0,7) !== start.slice(0,7);
      const statYear      = parseInt(start.slice(0,4),10);   // the contribution month's year, not the end's
      const monthGross    = mtd.gross + formGross();
      const sug = window.computeStatutory
        ? window.computeStatutory({ grossPay: monthGross, year: statYear })
        : null;
      const er = { sss:0, philhealth:0, pagibig:0 };
      let anyAuto = false;
      AUTOFIX.forEach(([k, id]) => {
        // D4 — THE EMPLOYER SHARE IS COMPUTED FIRST AND UNCONDITIONALLY.
        // These two statements used to sit BELOW the `edited[k]` bail-out, so
        // hand-adjusting one auto-managed EE figure by a single peso silently
        // dropped that agency's ER — and if it was the only auto key, cleared
        // anyAuto and with it the WHOLE ps-er-json block, so the payslip
        // printed "—" for all three employer rows. That contradicts this
        // codebase's own invariant (js/money-core.js: "ER stays table-computed
        // (er is never hand-typed)") and the same rule the Type A resolver
        // follows for 'fixed'. The employer's liability is set by the table and
        // the month's gross; what HR typed in the employee's column does not
        // change what the company owes.
        // 'fixed' KEEPS THE TABLE ER, exactly as Type A does. money-core's
        // resolver is `(cfg[k]==='exempt') ? 0 : stat.er[k]` — only `exempt`
        // zeroes the employer share; `fixed` sets the EMPLOYEE's column and
        // leaves the company's liability to the table. This block used to fill
        // er[k] only for 'auto', so `fixed`, `exempt` and unconfigured keys ALL
        // landed in the payslip doc as a literal 0 — and payslips/* stores the
        // three numbers WITHOUT statConfig, so js/bir.js is structurally unable
        // to tell those three apart. A `fixed` worker therefore rendered 0.00 in
        // the 1601-C employer columns: a positive assertion that nothing is owed,
        // on the document used to file and remit, worth ~P600/month/worker.
        // Now `exempt` alone leaves er[k] at 0; both other configured modes carry
        // the table figure, so a 0 in the doc unambiguously means "not tracked"
        // and bir.js's dagger treatment is correct again for exactly those rows.
        if (cfg[k] === 'auto' || cfg[k] === 'fixed') {
          anyAuto = true;                             // "any configured key" — drives ps-er-json below
          if (isLastPayWeek && sug && k !== 'tax') er[k] = sug.er[k] || 0;
        }
        const inp = $ps(id);
        if (!inp || edited[k]) return;              // EE amount only: HR typed here — hands off
        const amt = !isLastPayWeek ? 0
          : cfg[k] === 'auto' ? (sug ? (sug.ee[k]||0) : 0)
          : (parseFloat(profile[k]) || 0);          // 'fixed' — the flat monthly amount
        inp.value = amt.toFixed(2);
      });
      // ER suggestion (display + BIR 1601-C only — the weekly ledger leg still
      // posts netPay and books no ER expense; v12 WS24 decision 3 unchanged).
      if (erInput) erInput.value = (anyAuto && isLastPayWeek) ? JSON.stringify(er) : '';
      if (hintEl) {
        const bits = [];
        bits.push(isLastPayWeek
          ? `Auto amounts use this month's total gross to date (₱${fmt(monthGross)}${mtd.count?` — includes ₱${fmt(mtd.gross)} from ${mtd.count} saved payslip${mtd.count>1?'s':''} this month; delete any wrong draft first`:''}). Editable.`
          : `Statutory is deducted once a month, on the month's last payslip (monthly brackets).`);
        if (sug && sug.unverified) {
          bits.push(`<span style="color:var(--warning)">${emojiIcon('⚠',11)} Statutory table for ${escHtml(String(statYear))} is UNVERIFIED placeholder rates — have the accountant verify before relying on these amounts.</span>`);
        }
        hintEl.innerHTML = bits.join('<br/>');
        if (window.lucide) lucide.createIcons({ nodes: [hintEl] });
      }
      // D1's sibling for the summary: the four statutory EE amounts were just
      // assigned programmatically, so no 'input' reaches the listeners above and
      // the strip would keep showing a net computed on the PREVIOUS deductions.
      psSummary();
    };

    // MANUAL edits — every amount input that moves gross. (ps-hrs, ps-ot-hrs
    // and ps-meal are listed because HR may override them by hand, which fires
    // 'input' and does NOT go through recomputeHours.)
    ['ps-rph','ps-hrs','ps-ot-rate','ps-ot-hrs','ps-meal','ps-transport','ps-rent']
      .forEach(id => $ps(id)?.addEventListener('input', apply));
    // D7 — ps-start alone drives the month bracket now; ps-end is still bound
    // because apply() bails while EITHER date is half-typed, so completing ps-end
    // has to re-run the pass that bail skipped.
    $ps('ps-end')?.addEventListener('change', apply);
    $ps('ps-start')?.addEventListener('change', apply);
    // D1 — PROGRAMMATIC gross changes. recomputeHours() is the single funnel
    // for them: it is what the ".ps-time-input" listeners call, and it is the
    // last thing "Load from kiosk" does after assigning the times directly. The
    // previous direct '.ps-time-input' → apply binding here covered ONLY the
    // hand-typed case (recomputeHours fires no events) and left the kiosk
    // button — the recommended flow — computing statutory on a pre-load gross.
    // Binding through the hook instead also removes the double-run that a
    // direct listener plus the hook would cause on every keystroke in a time
    // field.
    psStatRefresh = apply;
    await apply();
  })();

  // ── v12 WS26 / v14 HR remediation P0 — pull HR-kiosk-recorded worker
  // attendance (attendance_worker/{profile.id}/records) into this SAME time-
  // log table so HR doesn't re-key hours already clocked at the kiosk.
  //
  // P0 fix #1 (pay-period length): the table has exactly 7 rows. The OLD code
  // bucketed every fetched record by its OWN weekday (bizDow), so a pay
  // period spanning more than 7 calendar days silently overwrote earlier
  // same-weekday rows with later ones — dropping days from pay with zero
  // warning (under-paying). Fixed by (a) refusing to auto-load when the
  // period exceeds 7 days, and (b) keying every record by its ACTUAL OFFSET
  // from the period start (never by weekday), so same-weekday collisions are
  // structurally impossible within a ≤7-day period.
  //
  // P0 fix #2 (CRITICAL #4 — forgotten clock-out): a record with
  // needsReview===true (worker-side contract: set when a forgotten clock-out
  // was closed the next day, or a shift exceeded the max) OR an implausible
  // hoursWorked (>16h — a phantom ~22-24h shift from an unclosed punch) is
  // EXCLUDED from the silent auto-sum and surfaced in a "Needs review before
  // paying" list instead, with the raw in/out times/selfies, so HR confirms
  // real hours instead of paying a phantom shift. Normal-record hours MATH
  // (computeDayHours) is completely untouched.
  $ps('ps-load-kiosk-btn')?.addEventListener('click', async () => {
    const start = $ps('ps-start').value, end = $ps('ps-end').value;
    if (!start || !end) { Notifs.showToast('Set pay period dates first','error'); return; }

    const oneDay = 24*60*60*1000;
    const startMs = new Date(start+'T12:00:00Z').getTime();
    const endMs   = new Date(end+'T12:00:00Z').getTime();
    const spanDays = Math.round((endMs - startMs)/oneDay) + 1;
    if (!(spanDays >= 1 && spanDays <= 7)) {
      Notifs.showToast(`Pay period is ${spanDays} days — the time log only has 7 rows (one per day). Shorten the period to 7 days or fewer, or enter hours manually.`, 'error');
      return;
    }

    const snap = await db.collection('attendance_worker').doc(profile.id).collection('records')
      .where(firebase.firestore.FieldPath.documentId(), '>=', start)
      .where(firebase.firestore.FieldPath.documentId(), '<=', end).get().catch(()=>({docs:[]}));

    const byOffset = {}; // row index 0..6, keyed by the record's ACTUAL DATE offset from ps-start — never by weekday
    snap.docs.forEach(d => {
      const r = d.data();
      const recMs = new Date(`${r.date}T12:00:00Z`).getTime();
      const offset = Math.round((recMs - startMs)/oneDay);
      if (offset >= 0 && offset <= 6) byOffset[offset] = r;
    });

    const flagged = [];   // excluded from auto-load — HR must confirm before these feed pay
    const loaded  = [];   // successfully auto-filled — shown in the audit panel too
    for (let i = 0; i < 7; i++) {
      const r = byOffset[i];
      const tin = $ps(`ps-tin-${i}`), tout = $ps(`ps-tout-${i}`);
      if (!r) {
        // OVERPAY FIX (v14 HR remediation) — the table's static defaults
        // (07:00–16:00 Mon–Fri, 07:00–18:00 Sat, ~8h/day) are a hand-entry
        // starting point, not a record of anyone actually clocking in. This
        // loop used to `continue` here, leaving that stale 8h default
        // standing in as "hours worked" for any day with NO kiosk attendance
        // record — silently paying a full day the worker never clocked.
        // Loading from the kiosk must now be authoritative for every row: a
        // day with no record gets cleared to blank/0h (needs-entry) instead
        // of quietly keeping the default, so only days with an actual
        // clock-in/out feed pay.
        if (tin)  { tin.value  = ''; tin.dataset.source  = 'manual'; }
        if (tout) { tout.value = ''; tout.dataset.source = 'manual'; }
        continue;
      }
      const rowLabel = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i];
      const implausible = typeof r.hoursWorked === 'number' && r.hoursWorked > 16;
      if (r.needsReview === true || implausible) {
        flagged.push({ ...r, _rowLabel: rowLabel, _implausible: implausible });
        continue;
      }
      if (tin)  { tin.value  = r.timeIn  || ''; tin.dataset.source  = (r.inSelfieUrl || r.inDistanceM  != null) ? 'kiosk-verified' : 'kiosk-manual'; }
      if (tout) { tout.value = r.timeOut || ''; tout.dataset.source = (r.outSelfieUrl || r.outDistanceM != null) ? 'kiosk-verified' : 'kiosk-manual'; }
      loaded.push({ ...r, _rowLabel: rowLabel });
    }
    recomputeHours();
    renderKioskReviewList(flagged, panel);
    renderKioskAuditPanel(loaded, flagged, panel);
    Notifs.showToast(flagged.length
      ? `Loaded kiosk hours — ${flagged.length} day(s) need review before paying (see list below).`
      : 'Loaded kiosk hours — review & adjust before saving.');
  });

  // ── Live CA remaining-balance preview ──
  const updateCaRemaining = () => {
    const balance = profile.caBalance || 0;
    const deduct  = parseFloat($ps('ps-ca')?.value) || 0;
    const remain  = Math.max(0, balance - deduct);
    const el = $ps('ps-ca-remaining-display');
    if (el) el.textContent = fmt(remain);
  };
  $ps('ps-ca')?.addEventListener('input', updateCaRemaining);

  $ps('ps-preview-btn').addEventListener('click', async () => {
    const d = collectPayslipData(profile, currentUser, panel);
    if (!d) return;
    const model = window.toPayslipModel(d, 'weekly');
    model.official = false; // never yet saved — a draft/projection by construction
    model.ytd = await window.payslipYtdWeekly(profile.id, (d.payPeriodStart||'').slice(0,4) || (window.bizYear?window.bizYear():new Date().getFullYear()));
    window.renderPayslipPage(model, () => window.renderPayrollHub(deptContainer(), currentUser, currentRole, 'B'));
  });

  // DOUBLE-SUBMIT / DOUBLE-DEDUCT FIX (v14 HR remediation) — `psSaving` is an
  // in-flight flag scoped to this ONE generator instance (a fresh closure per
  // openPayslipGenerator call, so it can't leak across different workers'
  // modals). Before this fix, double-clicking Save & Generate fired the
  // handler twice concurrently: two `payslips` docs got created for the same
  // period, and — worse — window.CashAdvance.deductWorker (a plain balance
  // decrement, not idempotent per payslip) ran twice, deducting the worker's
  // cash advance twice for one payslip. The button is disabled synchronously
  // on the first click so a second click before the first save settles is a
  // no-op, not a second write.
  let psSaving = false;
  $ps('ps-save-btn').addEventListener('click', async () => {
    if (psSaving) return;
    // v14 re-audit fix — issuing a payslip is a money-tier act (firestore.rules
    // payslips create/update is isMoneyAdmin() now, matching the president-only
    // delete that was always there). Same stale-DOM rationale as the worker
    // profile save above.
    if (typeof isMoneyPriv === 'function' && !isMoneyPriv()) {
      Notifs.showToast('Issuing a payslip is President / Manager / Finance only.','error');
      return;
    }
    const d = collectPayslipData(profile, currentUser, panel);
    if (!d) return;

    // ── DOUBLE-PAY GUARD — runs BEFORE psSaving is latched, so a refusal or a
    // cancelled confirm leaves the button live and this modal usable. See
    // _weeklyRunCollision's header: the weekly run and this generator both
    // emit `payslips` docs and nothing else keeps them off the same worker's
    // same week.
    //
    // A THROWN read is a REFUSAL, never a pass. "Couldn't check" and "nothing
    // to worry about" are the same code path if you .catch() this, and that
    // path pays someone twice.
    let _collide;
    try {
      _collide = await _weeklyRunCollision(profile.id, profile.name, d.payPeriodStart, d.payPeriodEnd);
    } catch (chkErr) {
      console.error('weekly-run collision check failed', chkErr);
      Notifs.showToast('Could not check this week\'s pay run — refusing to issue the payslip. Try again; if it keeps failing you may not have payroll access.', 'error');
      return;
    }
    if (_collide.block) {
      await confirmDialog({
        title: 'Already paid for this week',
        message: _collide.block, html: true,
        confirmLabel: 'OK', cancelLabel: 'OK'
      });
      return;                                     // no branch here issues the payslip
    }
    if (_collide.warn) {
      const ok = await confirmDialog({
        title: 'Possible double payment',
        message: _collide.warn + '<br/><br/>Issue this payslip anyway?',
        html: true, danger: true, confirmLabel: 'Issue anyway'
      });
      if (!ok) return;
    }

    psSaving = true;
    const saveBtn = $ps('ps-save-btn');
    const saveBtnHTML = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    try {
      d.proofUrl = proofFile?.url || null;
      d.status = 'draft';
      d.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      d.createdBy = currentUser.uid;
      const ref = await db.collection('payslips').add(d);
      // Apply CA deduction to the worker's running balance — transaction-guarded
      // re-read (v12 WS22), instead of trusting the balance the modal opened
      // with. AWAITED (was already awaited) but now RECONCILED: a swallowed
      // `.catch(()=>{})` here used to let this fail completely silently — the
      // payslip would show a cash-advance deduction that never actually
      // happened to the worker's real worker_profiles.caBalance, with no
      // signal to HR that the two are now out of sync. The double-submit
      // guard above is what keeps this call to exactly once per payslip;
      // this now also surfaces (rather than eats) a genuine failure so HR
      // knows to reconcile the balance by hand.
      if (d.deductions.other.cashAdvance > 0) {
        try {
          await window.CashAdvance.deductWorker(profile.id, d.deductions.other.cashAdvance, { reason:'weekly-payslip', payslipId: ref.id });
        } catch (caErr) {
          console.error('CA deduction failed for saved payslip', ref.id, caErr);
          // Notifs.showToast renders via textContent (plain text) — no escHtml
          // here, that's for innerHTML sinks only (see js/notifications.js's
          // own comment on this exact footgun).
          Notifs.showToast(`Payslip saved, but the ₱${fmt(d.deductions.other.cashAdvance)} cash-advance deduction FAILED to apply — reconcile ${profile.name||'the worker'}'s CA balance manually.`, 'error');
        }
      }
      // Note: the general-ledger entry is posted when the payslip is "Submitted" (see openPayslipHistory).
      closeModal();
      Notifs.success('Payslip saved as draft! Verify and file it from Payslip History.');
      const model = window.toPayslipModel({...d, id: ref.id}, 'weekly');
      model.ytd = await window.payslipYtdWeekly(profile.id, (d.payPeriodStart||'').slice(0,4) || (window.bizYear?window.bizYear():new Date().getFullYear()));
      setTimeout(() => window.renderPayslipPage(model, () => window.renderPayrollHub(deptContainer(), currentUser, currentRole, 'B')), 400);
      // psSaving intentionally left true / button left disabled — closeModal()
      // just tore this panel's DOM down, so there is nothing left to re-submit.
    } catch (err) {
      // The payslip write itself (or the YTD lookup before renderPayslipPage)
      // failed — reset the guard so HR can retry instead of the button being
      // permanently stuck disabled.
      console.error('payslip save failed', err);
      Notifs.showToast('Failed to save payslip — please try again.', 'error');
      psSaving = false;
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = saveBtnHTML; }
    }
  });
}

// ── v14 HR remediation P0/P1 — "Load Kiosk Hours" review + audit panels ────
// renderKioskReviewList: days EXCLUDED from the auto-sum (needsReview or an
// implausible >16h shift). HR must confirm the real hours and hand-key them
// into the table above before this pay period is saved — nothing here feeds
// pay automatically.
function renderKioskReviewList(flagged, root) {
  const area = (root || document).querySelector('#ps-kiosk-review-area');
  if (!area) return;
  if (!flagged || !flagged.length) { area.innerHTML = ''; return; }
  area.innerHTML = `
    <div style="margin-top:10px;border:1.5px solid var(--danger,#dc2626);border-radius:8px;padding:10px;background:var(--surface)">
      <div style="font-size:11px;font-weight:700;color:var(--danger,#dc2626);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">
        ${emojiIcon('⚠️',14)} Needs review before paying (${flagged.length})
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">These day(s) were <strong>excluded</strong> from the hours loaded above — confirm the real time in/out with the worker (see selfies/distance below), then hand-key the correct value into the table if it should be paid.</div>
      ${flagged.map(r => `
        <div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:6px;background:var(--surface2)">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px">${escHtml(r._rowLabel||'')} · ${escHtml(r.date||'')}
            ${r.needsReview===true?` <span class="badge badge-orange">Flagged for review</span>`:''}
            ${r._implausible?` <span class="badge badge-orange">Implausible hours (&gt;16h)</span>`:''}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:6px">
            ${_hrPunchDetail(r, 'in')}
            ${r.timeOut ? _hrPunchDetail(r, 'out') : ''}
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${typeof r.hoursWorked === 'number' ? `<span style="font-size:11px;color:var(--text-muted)">Raw logged: ${r.hoursWorked.toFixed(2)}h</span>` : ''}
            ${_hrVerifiedBadge(r)}
          </div>
        </div>`).join('')}
    </div>`;
  _hrBindAttThumbs(area);
  if (window.lucide) lucide.createIcons({ nodes: [area] });
}

// renderKioskAuditPanel: P1 buddy-punch deterrent — a compact, always-visible
// audit view of every day actually loaded from the kiosk (selfies/distance/
// accuracy/verified marker), so HR can spot-check ANY day, not just flagged
// ones, without leaving the payslip screen. Collapsed by default (details/
// summary — no new CSS/JS dependency) since most weeks need no scrutiny.
function renderKioskAuditPanel(loaded, flagged, root) {
  const area = (root || document).querySelector('#ps-kiosk-audit-area');
  if (!area) return;
  const all = [...(loaded||[]), ...(flagged||[])].sort((a,b) => (a.date||'').localeCompare(b.date||''));
  if (!all.length) { area.innerHTML = ''; return; }
  area.innerHTML = `
    <details style="margin-top:10px;border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--surface2)">
      <summary style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;cursor:pointer">Kiosk record audit (${all.length} day${all.length>1?'s':''} — selfie/distance/accuracy spot-check)</summary>
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
        ${all.map(r => `
          <div style="border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--surface)">
            <div style="font-size:11px;font-weight:700;margin-bottom:6px">${escHtml(r._rowLabel||'')} · ${escHtml(r.date||'')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:6px">
              ${_hrPunchDetail(r, 'in')}
              ${r.timeOut ? _hrPunchDetail(r, 'out') : ''}
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              ${typeof r.hoursWorked === 'number' ? `<span style="font-size:11px;color:var(--text-muted)">${r.hoursWorked.toFixed(2)}h logged</span>` : ''}
              ${_hrVerifiedBadge(r)}
            </div>
          </div>`).join('')}
      </div>
    </details>`;
  _hrBindAttThumbs(area);
  if (window.lucide) lucide.createIcons({ nodes: [area] });
}

// Hours between two "HH:MM" time strings, minus a flat 1hr lunch deduction
// if the shift overlaps the 12:00–13:00 lunch window. Handles overnight shifts.
function computeDayHours(timeIn, timeOut) {
  if (!timeIn || !timeOut) return 0;
  const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  let inM = toMin(timeIn), outM = toMin(timeOut);
  if (outM <= inM) outM += 24*60; // overnight shift
  let mins = outM - inM;
  const lunchStart = 12*60, lunchEnd = 13*60;
  if (inM < lunchEnd && outM > lunchStart) mins -= 60; // shift spans 12–1PM lunch
  return Math.max(0, mins/60);
}

// ── Weekly payslip money — ONE SOURCE OF TRUTH ─────────────────────────────
// Owner: "I just want to see the total before submitting it." The generator
// showed a running total in HOURS and no pesos at all; the money existed
// nowhere until collectPayslipData ran, on Preview or on Save.
//
// psFormInputs(root) reads every amount the weekly math depends on; psTotals(v)
// IS that math, moved here VERBATIM from collectPayslipData (same statements,
// same order, same rounding — not re-derived). collectPayslipData (what
// actually gets SAVED) and the live summary strip in openPayslipGenerator both
// go through this one pair, so the net the owner reads before pressing Save &
// Generate is the net that lands in `payslips` BY CONSTRUCTION, not because two
// copies of one expression are being kept in step by hand. This screen has
// already been bitten by exactly that class of drift — see the statutory §4.3
// lockstep note in loadPayrollTable, and D1 above.
//
// `root` is the generator's own openPage panel, never `document`: #ps-* ids are
// not unique across the page stack, and a buried or dying generator would win a
// document-wide lookup — the displayed figure and the saved figure would then be
// read off two different forms. The `|| document` fallback exists only so the
// helpers stay usable standalone; every caller in this file passes the panel.
function psFormInputs(root) {
  const num = id => parseFloat((root || document).querySelector('#' + id)?.value) || 0;
  return {
    daily:     num('ps-daily'),        // carried onto the doc for reference; never enters the math
    rph:       num('ps-rph'),
    hrs:       num('ps-hrs'),
    otRate:    num('ps-ot-rate'),
    otHrs:     num('ps-ot-hrs'),
    meal:      num('ps-meal'),
    transport: num('ps-transport'),
    rent:      num('ps-rent'),
    sss:       num('ps-sss'),
    ph:        num('ps-ph'),
    pib:       num('ps-pib'),
    ca:        num('ps-ca'),
    loans:     num('ps-loans'),
    tax:       num('ps-tax'),
    paid:      num('ps-paid')
  };
}
// Pure — no DOM, no Firestore, no rounding policy of its own beyond the two
// toFixed(2) calls the saved payslip has always used.
function psTotals(v) {
  const regTotal = parseFloat((v.rph * v.hrs).toFixed(2));  // hourly rate × hours worked
  const otTotal  = parseFloat((v.otRate * v.otHrs).toFixed(2));
  const allowTotal = v.meal + v.transport + v.rent;
  const grossPay = regTotal + otTotal + allowTotal;
  const govTotal   = v.sss + v.ph + v.pib;
  const otherTotal = v.ca + v.loans + v.tax;
  const totalDeductions = govTotal + otherTotal;
  const totalPay = grossPay - totalDeductions;
  const netPay   = totalPay - v.paid;
  return { regTotal, otTotal, allowTotal, grossPay, govTotal, otherTotal, totalDeductions, totalPay, netPay };
}

function collectPayslipData(profile, currentUser, panel) {
  // `panel` is openPayslipGenerator's own openPage element — see psFormInputs
  // for why every lookup in here is scoped to it.
  const $ps = id => (panel || document).querySelector('#' + id);
  const v = psFormInputs(panel);
  const t = psTotals(v);
  const daily = v.daily, rph = v.rph, hrs = v.hrs;
  const regTotal = t.regTotal;                                   // hourly rate × hours worked
  const otRate = v.otRate, otHrs = v.otHrs, otTotal = t.otTotal;
  const meal = v.meal, transport = v.transport, rent = v.rent;
  const allowTotal = t.allowTotal;
  const grossPay = t.grossPay;

  const sss = v.sss, ph = v.ph, pib = v.pib;
  const ca = v.ca, loans = v.loans, tax = v.tax;
  const govTotal = t.govTotal;
  const otherTotal = t.otherTotal;
  const totalDeductions = t.totalDeductions;
  const totalPay = t.totalPay;
  const paid = v.paid;
  const netPay = t.netPay;

  const periodStart = $ps('ps-start').value;
  const periodEnd   = $ps('ps-end').value;
  if (!periodStart || !periodEnd) { Notifs.showToast('Set pay period dates','error'); return null; }

  const caBalanceBefore = profile.caBalance || 0;
  const caBalanceAfter  = Math.max(0, caBalanceBefore - ca);

  // v14 HR remediation P2 — payslip provenance (display-only, non-destructive):
  // carry each day's data-source (manual/kiosk-manual/kiosk-verified, set by
  // the "Load Kiosk Hours" flow and reset to 'manual' on any hand-edit — see
  // openPayslipGenerator) onto the saved payslip so HR can later tell a
  // location-verified punch from a hand-entered row. Never affects the hours
  // MATH below — same computeDayHours call as before.
  const timeLog = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=>({
    day: d,
    timeIn:  $ps(`ps-tin-${i}`)?.value || '',
    timeOut: $ps(`ps-tout-${i}`)?.value || '',
    hours: computeDayHours($ps(`ps-tin-${i}`)?.value, $ps(`ps-tout-${i}`)?.value),
    source: $ps(`ps-tin-${i}`)?.dataset.source || 'manual'
  }));

  return {
    workerId: profile.id,
    workerName: profile.name,
    workerIdNum: profile.idNumber||'',
    jobTitle: profile.jobTitle||'',
    department: profile.department||'',
    tinNum: profile.tinNum||'',
    ssNum: profile.ssNum||'',
    phNum: profile.phNum||'',
    pagibigNum: profile.pagibigNum||'',
    payPeriodStart: periodStart,
    payPeriodEnd: periodEnd,
    payPeriodMonth: periodStart.slice(0,7),
    payDate: $ps('ps-date').value,
    company: $ps('ps-company').value||'Barro Kitchens',
    preparedBy: $ps('ps-preparer').value||currentUser?.displayName||'',
    regular: { dailyRate: daily, ratePerHr: rph, hrsWorked: hrs, total: regTotal },
    overtime: { ratePerHr: otRate, hours: otHrs, total: otTotal },
    allowances: { meal, transport, rent, total: allowTotal },
    grossPay,
    deductions: {
      govt: { sss, philhealth: ph, pagibig: pib, total: govTotal },
      other: { cashAdvance: ca, loans, taxes: tax, total: otherTotal }
    },
    // Statutory-config spec §5.3(5) — ER carried from the generator's table
    // suggestion when the worker is configured 'auto' (display + BIR 1601-C
    // only; the WPAY ledger leg still posts netPay and books no ER expense —
    // weekly ER stays out of the books, exactly as v12 WS24 decision 3 decided).
    // #ps-er-json only exists for a CONFIGURED worker on a last pay week;
    // absent element or empty value -> null, byte-identical to before.
    employerShare: (() => { try {
      const el = $ps('ps-er-json');
      return el && el.value ? JSON.parse(el.value) : null;
    } catch(_) { return null; } })(),
    caBalanceBefore,
    caBalanceAfter,
    totalDeductions,
    totalPay,
    paid,
    netPay,
    schedule: timeLog
  };
}

// ═══════════════════════════════════════════════════════════
//  THE PAYSLIP — ONE branded template (v12 WS24)
//  toPayslipModel normalizes either cycle's raw source into ONE PayslipModel;
//  buildPayslipHTML renders that model; renderPayslipPage hosts it in-app
//  (no pop-ups — same-document window.print(), per the owner's directive).
// ═══════════════════════════════════════════════════════════
window.toPayslipModel = function(source, kind) {
  const g = (o,a,b)=> (o?.[a] ?? o?.[b] ?? 0);            // casing-tolerant getter (WS21 D6 canonical lowercase)
  if (kind === 'monthly') {
    // source = a frozen pay_runs line OR a salary_history mirror doc (same field set)
    const base = source.base ?? source.salary ?? 0;
    const allowance = source.allowance ?? 0;
    const ee = { sss:g(source,'sss'), philhealth:g(source,'philhealth','philHealth'),
                 pagibig:g(source,'pagibig','pagIbig'), tax:source.tax??0 };
    const er = source.er ? { sss:source.er.sss||0, philhealth:source.er.philhealth||0, pagibig:source.er.pagibig||0 } : null;
    const gross = base + allowance;
    const eeTotal = ee.sss+ee.philhealth+ee.pagibig+ee.tax;
    const other = source.otherDeductions ?? source.deductions ?? 0;
    const caBefore = source.caBalance ?? source.caBalanceBefore ?? 0;
    const caInst = source.caPlanned ?? source.caDeducted ?? 0;
    // PAYSLIP-OVERHAUL-SPEC.md §2 — human docNumber instead of the raw
    // Firestore uid (was `PS-{month}-{uid}`, printing a 28-char Firebase Auth
    // uid on an employee-facing document, TWICE — header + footer). Prefers
    // the real employeeId when the source carries one; falls back to the
    // last 4 chars of the uid (uppercased) — still filesystem-safe
    // ([A-Z0-9-] only) and never the raw id. Month digits only (dash
    // stripped) so it reads as a serial, not a date fragment.
    const _uidRef = source.uid || source.userId || '';
    const _monthKey = String(source.month || source.runMonth || '').replace(/-/g,'');
    const _empIdPart = (source.employeeId && String(source.employeeId).trim())
      || _uidRef.slice(-4).toUpperCase();
    return {
      kind:'monthly', official:true,
      docNumber:`PS-${_monthKey}-${_empIdPart}`,
      // Raw doc id/uid — never printed; kept for debugging/audit panels and
      // as the write target for §1's identity-only edit panel.
      sourceRef: _uidRef,
      // Raw 'YYYY-MM' (WITH the dash, unlike docNumber's stripped serial) —
      // §1's edit panel needs this to address salary_history/{uid}_{month}
      // and pay_runs/{month} directly.
      monthKey: String(source.month || source.runMonth || ''),
      periodLabel:window.fmtMonthLabel(source.month||source.runMonth),
      payDateLabel: source.payDateLabel || '',
      // v12 WS39 — statutory IDs now live on payroll/{uid} (frozen onto the pay-
      // run line / salary_history mirror at Compute/Disburse); previously hard-
      // coded to '' for every monthly employee (the alphalist/2316 data gap).
      employee:{ name:source.name||source.userName||'', idNumber:source.employeeId||'',
                 jobTitle:source.title||'', department:source.department||'',
                 tin:source.tinNum||'', sss:source.ssNum||'', philhealth:source.phNum||'', pagibig:source.pagibigNum||'' },
      earnings:{ base, allowance, overtime:0, gross },
      statutory:{ ee, er },
      otherDeductions:other,
      ca:{ before:caBefore, installment:caInst, after:Math.max(0, caBefore-caInst) },
      net: source.finalPay ?? (gross - eeTotal - other - caInst),
      ytd:{ gross:0, net:0, thirteenthAccrual:0 },   // filled by caller (needs the year query)
      // Note to employee — display-only passthrough of whatever the caller put
      // on `source.hrNote` ({text,setBy,setByName,setAt}); never fed into any
      // figure above. Callers source this from pay_runs.employeeNotes[uid]
      // pre-disburse or the salary_history mirror's own hrNote field post-
      // disburse — see openEmployeeNoteModal / disbursePayRun.
      hrNote: source.hrNote || null,
      performance: (source.kpiScore!=null||source.perfFactor!=null)
        ? { kpi:source.kpiScore||0, att:source.attScore||0, perfFactor:source.perfFactor??1, policy:source.policy||'flat' } : null,
      timeLog:null,
      signatures:[{label:'Prepared by',name:'',title:'Finance'},{label:'Verified by',name:'',title:'HR'},{label:'Approved by',name:(window.BRAND&&window.BRAND.legal.signatory.name)||'',title:'President'}],
      proofUrl:''
    };
  }
  // kind === 'weekly'  (source = a payslips/{id} doc)
  const dg = source.deductions?.govt || {};
  const ee = { sss:dg.sss||0, philhealth:g(dg,'philhealth')||0, pagibig:g(dg,'pagibig')||0, tax:source.deductions?.other?.taxes||0 };
  const er = source.employerShare ? { sss:source.employerShare.sss||0, philhealth:source.employerShare.philhealth||0, pagibig:source.employerShare.pagibig||0 } : null;
  // PAYSLIP-OVERHAUL-SPEC.md §2 — human docNumber (was the raw `payslips`
  // auto-id, e.g. "sIA8AHYbLWXvDJ4…"). Workers carry a BI-W-### human id
  // (nextWorkerIdNumber, hr.js) — prefer that; fall back to the last 4 chars
  // of the saved doc id, then the worker_profiles doc id (collectPayslipData
  // always sets `workerId`), then a literal 'DRAFT' for an in-memory preview
  // that was never saved and has neither. Derived at render time — nothing
  // is retro-written to any saved doc.
  const _wStart = String(source.payPeriodStart || '').replace(/-/g,'');
  const _wIdPart = (source.workerIdNum && String(source.workerIdNum).trim())
    || (source.id ? String(source.id).slice(-4).toUpperCase() : '')
    || (source.workerId ? String(source.workerId).slice(-4).toUpperCase() : '')
    || 'DRAFT';
  return {
    kind:'weekly', official:true, docNumber:`PS-W-${_wStart}-${_wIdPart}`,
    // Raw doc id (payslips/{id}) — never printed; blank for an unsaved
    // preview. profileId (worker_profiles/{id}) is always present
    // (collectPayslipData always sets workerId=profile.id) — §1's edit
    // panel writes identity fields there regardless of save state.
    sourceRef: source.id || '',
    profileId: source.workerId || '',
    periodLabel:`${source.payPeriodStart||''} – ${source.payPeriodEnd||''}`,
    payDateLabel:source.payDate||'',
    employee:{ name:source.workerName||'', idNumber:source.workerIdNum||'', jobTitle:source.jobTitle||'',
               department:source.department||'', tin:source.tinNum||'', sss:source.ssNum||'',
               philhealth:source.phNum||'', pagibig:source.pagibigNum||'' },
    earnings:{ base:source.regular?.total||0, allowance:source.allowances?.total||0, overtime:source.overtime?.total||0,
               gross:source.grossPay||0 },
    statutory:{ ee, er },
    otherDeductions:(source.deductions?.other?.loans||0),
    ca:{ before:source.caBalanceBefore||0, installment:source.deductions?.other?.cashAdvance||0, after:source.caBalanceAfter||0 },
    net:source.netPay||0,
    ytd:{ gross:0, net:0, thirteenthAccrual:0 },   // filled by caller (weekly year query)
    performance:null,
    timeLog:source.schedule||[],
    signatures:[{label:'Prepared by',name:source.preparedBy||'',title:'Finance'},{label:'Verified by',name:'',title:'HR'},{label:'Approved by',name:(window.BRAND&&window.BRAND.legal.signatory.name)||'',title:'President'}],
    proofUrl:source.proofUrl||''
  };
};

// ── Shared 13th-month accrual helper (v14 Wave 4 Batch F4) ─────────────────
// PH law: 13th-month pay = TOTAL basic salary actually EARNED during the
// calendar year, divided by the fixed statutory denominator of 12 — never by
// months worked (a common miscalculation: a mid-year hire earning ₱20,000/mo
// for 6 months earned ₱120,000 basic → accrual = 120,000/12 = ₱10,000, NOT
// 120,000/6 = ₱20,000).
//
// The bug this replaces: baseSum previously summed EVERY salary_history row
// found in the year-range query with no lower bound, so a stray/backfilled
// row dated before the employee's actual hire month silently inflated
// baseSum (e.g. a seeded row for a month never worked). That contamination
// made the July-hire example above compute 240,000/12 = ₱20,000 instead of
// the correct ₱10,000.
//
// Fix: guard baseSum to rows dated on/after the employee's hire month (from
// users/{uid}.startDate; if that field is absent — e.g. legacy accounts
// created before startDate was tracked — fall back to the EARLIEST month
// actually present in `rows`, which is the best available signal). Rows
// outside [year, year] are already excluded by the caller's query.
// `monthsWorked` is returned for on-screen CONTEXT ONLY — it is never used
// as a divisor.
//
// usersByUid (optional): {uid:{startDate}} — pass a prefetched map when
// looping many employees (e.g. the BIR Alphalist) to avoid one users/{uid}
// read per employee. Single-shot callers (a single payslip) omit it and we
// do the one read ourselves.
window.thirteenthMonthFor = async function(uid, year, rows, usersByUid) {
  const yr = String(year);
  const yearRows = (rows||[]).filter(r => (r.month||'').slice(0,4) === yr);
  const monthsPresent = yearRows.map(r=>r.month).filter(Boolean).sort();
  let hireMonth = '';
  if (usersByUid) {
    hireMonth = (usersByUid[uid] && usersByUid[uid].startDate || '').slice(0,7);
  } else {
    try {
      const uDoc = await db.collection('users').doc(uid).get();
      if (uDoc.exists) hireMonth = (uDoc.data().startDate||'').slice(0,7);
    } catch(_){}
  }
  // Documented fallback: no usable startDate on file -> earliest month we
  // actually have data for is the best guess at "when they started earning".
  const effectiveHireMonth = (hireMonth && hireMonth >= `${yr}-01` && hireMonth <= `${yr}-12`)
    ? hireMonth : (monthsPresent[0] || `${yr}-01`);
  const worked = yearRows.filter(r => (r.month||'') >= effectiveHireMonth);
  const baseSum = worked.reduce((s,r)=> s + (r.base ?? r.salary ?? 0), 0);
  return {
    thirteenthAccrual: Math.round((baseSum/12)*100)/100,   // ← denominator is ALWAYS 12 (PH law), never monthsWorked
    monthsWorked: worked.length,                            // display context only
    baseSum,
    hireMonth: effectiveHireMonth
  };
};

// YTD helpers — display-computed each render, never stored on the payslip.
window.payslipYtdMonthly = async function(uid, year) {
  const snap = await db.collection('salary_history').where('userId','==',uid)
    .where('month','>=',`${year}-01`).where('month','<=',`${year}-12`).get().catch(()=>({docs:[]}));
  const rows = snap.docs.map(d=>d.data());
  let gross=0, net=0, tax=0, sss=0, philhealth=0, pagibig=0;
  rows.forEach(r=>{ const b=r.base??r.salary??0;
    gross+=b+(r.allowance||0); net+=(r.finalPay??r.netPay??0);
    tax+=(r.tax||0); sss+=(r.sss||0); philhealth+=(r.philhealth??r.philHealth??0); pagibig+=(r.pagibig??r.pagIbig??0); });
  const th = await window.thirteenthMonthFor(uid, year, rows);
  // v12 WS39 — additive: tax/sss/philhealth/pagibig YTD sums for the alphalist/
  // 2316 worksheets. Existing callers (payslip YTD card) only read gross/net/
  // thirteenthAccrual and are unaffected.
  return { gross, net, thirteenthAccrual: th.thirteenthAccrual, monthsWorked: th.monthsWorked, tax, sss, philhealth, pagibig };   // WS21 D7
};
window.payslipYtdWeekly = async function(workerId, year) {
  const snap = await db.collection('payslips').where('workerId','==',workerId)
    .where('payPeriodStart','>=',`${year}-01-01`).where('payPeriodStart','<=',`${year}-12-31`).get().catch(()=>({docs:[]}));
  let gross=0, net=0, baseSum=0;
  snap.docs.forEach(d=>{ const r=d.data(); baseSum+=r.regular?.total||0; gross+=r.grossPay||0; net+=r.netPay||0; });
  return { gross, net, thirteenthAccrual: Math.round((baseSum/12)*100)/100 };
};

// The ONE branded template — renders a PayslipModel to inner HTML (no <html>
// wrapper; hosted by renderPayslipPage inside #page-content).
// PAYSLIP-OVERHAUL-SPEC.md §2 — blank gov-ID/employee-ID cells rendered as
// empty <td>s, reading as broken. A muted "— not on file" placeholder pairs
// with §1's edit affordance (which lets finance/president backfill these in
// place instead of digging through the Edit Payroll modal separately).
function _notOnFile(v) {
  return v ? escHtml(v) : `<span style="color:var(--text-muted,#888);font-style:italic;font-size:10px">— not on file</span>`;
}
window.buildPayslipHTML = function(model) {
  const f = n => (parseFloat(n)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const m = model, s = m.statutory, er = s.er;
  const erCell = k => er ? f(er[k]) : '—';
  const badge = m.official ? '' : `<div class="ps-badge-proj">PROJECTION — not yet disbursed</div>`;
  // Payslips are BIR/DOLE-facing — DTI trade name + real TIN (matches what this
  // template has always printed, and WS14's own resolution for this doc type).
  // PAYSLIP-OVERHAUL-SPEC.md §2 — suppressRegistration:true drops
  // brandEntity('bir').registration, which today is the literal placeholder
  // string "BIR registration pending accountant confirmation (D6)" — an
  // internal to-do note, not something that belongs on an employee-facing
  // document. footerNote drops the periodLabel repeat (already shown
  // top-right via dateLabel) and prints the new human docNumber once.
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'PAYSLIP', entity: window.brandEntity ? window.brandEntity('bir') : null,
    accent: '#1E3A5F', docNumber: m.docNumber, dateLabel: m.periodLabel,
    signatures: m.signatures, suppressRegistration: true,
    footerNote: 'System-generated payslip · ' + escHtml(m.docNumber)
  }) : null;
  const perf = m.performance ? `
    <div class="ps-sec-h">Performance</div>
    <table class="ps-t">
      <tr><td>Task KPI (70%)</td><td class="num">${Math.round(m.performance.kpi*100)}%</td></tr>
      <tr><td>Attendance (30%)</td><td class="num">${Math.round(m.performance.att*100)}%</td></tr>
      <tr class="ps-sub"><td>Performance factor (policy: ${escHtml(m.performance.policy)})</td><td class="num">${m.performance.perfFactor.toFixed(2)}×</td></tr>
    </table>` : '';
  // v14 HR remediation P2 — provenance column (source: kiosk-verified/kiosk-
  // manual/manual, set by openPayslipGenerator's Load Kiosk Hours flow).
  // Display-only and additive: older saved payslips have no r.source at all,
  // so the column is only shown when at least one row actually carries it —
  // pre-existing payslips render exactly as before.
  const _hasSrc = m.timeLog && m.timeLog.some(r => r.source);
  const _srcCell = (src) => src==='kiosk-verified' ? 'Kiosk (verified)' : src==='kiosk-manual' ? 'Kiosk (HR)' : src ? 'Hand-keyed' : '';
  const timelog = (m.timeLog && m.timeLog.length) ? `
    <div class="ps-sec-h">Daily Time Log</div>
    <table class="ps-t"><thead><tr><th>Day</th><th>Time In</th><th>Time Out</th><th class="num">Hours</th>${_hasSrc?'<th>Source</th>':''}</tr></thead>
    <tbody>${m.timeLog.map(r=>`<tr><td>${escHtml(r.day)}</td><td>${escHtml(r.timeIn||'—')}</td><td>${escHtml(r.timeOut||'—')}</td><td class="num">${(r.hours||0).toFixed(2)}</td>${_hasSrc?`<td style="font-size:10px">${escHtml(_srcCell(r.source))}</td>`:''}</tr>`).join('')}</tbody></table>` : '';
  return `
  ${_lh ? `<style>${_lh.printCSS}</style>` : ''}
  ${_lh ? _lh.headerHTML : `<div class="lh-head"><div class="lh-name">${escHtml((window.BRAND&&window.BRAND.legal.dtiName)||'')}</div><div class="lh-doc"><div class="lh-title">PAYSLIP</div><div class="lh-no">${escHtml(m.docNumber)}</div><div class="lh-date">${escHtml(m.periodLabel)}</div></div></div>`}
  ${badge}
  <div class="ps-sec-h">Employee</div>
  <table class="ps-t">
    <tr><td class="lbl">Name</td><td>${escHtml(m.employee.name)}</td><td class="lbl">TIN</td><td>${_notOnFile(m.employee.tin)}</td></tr>
    <tr><td class="lbl">ID</td><td>${_notOnFile(m.employee.idNumber)}</td><td class="lbl">SSS</td><td>${_notOnFile(m.employee.sss)}</td></tr>
    <tr><td class="lbl">Job Title</td><td>${escHtml(m.employee.jobTitle)}</td><td class="lbl">PhilHealth</td><td>${_notOnFile(m.employee.philhealth)}</td></tr>
    <tr><td class="lbl">Department</td><td>${escHtml(m.employee.department)}</td><td class="lbl">Pag-IBIG</td><td>${_notOnFile(m.employee.pagibig)}</td></tr>
    <tr><td class="lbl">Pay Period</td><td>${escHtml(m.periodLabel)}</td><td class="lbl">Pay Date</td><td>${escHtml(m.payDateLabel||'—')}</td></tr>
  </table>

  <div class="ps-sec-h">Earnings</div>
  <table class="ps-t">
    <tr><td>Basic Pay</td><td class="num">${f(m.earnings.base)}</td></tr>
    <tr><td>Allowances</td><td class="num">${f(m.earnings.allowance)}</td></tr>
    ${m.earnings.overtime?`<tr><td>Overtime</td><td class="num">${f(m.earnings.overtime)}</td></tr>`:''}
    <tr class="ps-gross"><td>Gross Pay</td><td class="num">${f(m.earnings.gross)}</td></tr>
  </table>

  <div class="ps-sec-h">Deductions &amp; Contributions</div>
  <table class="ps-t">
    <thead><tr><th>Contribution</th><th class="num">Employee</th><th class="num">Employer</th></tr></thead>
    <tbody>
      <tr><td>SSS</td><td class="num">${f(s.ee.sss)}</td><td class="num">${erCell('sss')}</td></tr>
      <tr><td>PhilHealth</td><td class="num">${f(s.ee.philhealth)}</td><td class="num">${erCell('philhealth')}</td></tr>
      <tr><td>Pag-IBIG</td><td class="num">${f(s.ee.pagibig)}</td><td class="num">${erCell('pagibig')}</td></tr>
      <tr><td>Withholding Tax</td><td class="num">${f(s.ee.tax)}</td><td class="num">—</td></tr>
      ${m.otherDeductions?`<tr><td>Other Deductions</td><td class="num">${f(m.otherDeductions)}</td><td class="num">—</td></tr>`:''}
    </tbody>
  </table>

  <div class="ps-sec-h">Cash Advance</div>
  <table class="ps-t">
    <tr><td>Balance (before)</td><td class="num">${f(m.ca.before)}</td></tr>
    <tr><td>Installment this period</td><td class="num">${f(m.ca.installment)}</td></tr>
    <tr class="ps-sub"><td>Balance (after)</td><td class="num">${f(m.ca.after)}</td></tr>
  </table>

  ${m.hrNote && m.hrNote.text ? `
  <div class="ps-sec-h">Note from HR</div>
  <div style="padding:8px 10px;background:var(--surface2,#f4f4f4);border:1px solid var(--border,#ddd);border-radius:6px;font-size:12px;color:var(--text,#222);white-space:pre-wrap">${escHtml(m.hrNote.text)}</div>` : ''}

  ${perf}

  <table class="ps-t ps-net-t">
    <tr class="ps-net"><td>NET PAY</td><td class="num">₱${f(m.net)}</td></tr>
  </table>

  <div class="ps-sec-h">Year to Date (${escHtml(String((window.bizYear?window.bizYear():new Date().getFullYear())))})</div>
  <table class="ps-t">
    <tr><td>YTD Gross</td><td class="num">${f(m.ytd.gross)}</td></tr>
    <tr><td>YTD Net</td><td class="num">${f(m.ytd.net)}</td></tr>
    <tr class="ps-sub"><td>13th-Month Accrual (est.)${m.ytd.monthsWorked?` <span style="font-weight:400;color:var(--text-muted)">— ${m.ytd.monthsWorked} mo. worked this year</span>`:''}</td><td class="num">${f(m.ytd.thirteenthAccrual)}</td></tr>
  </table>

  ${timelog}

  ${_lh ? _lh.footerHTML : `<div class="ps-sigs">${m.signatures.map(sig=>`<div class="ps-sig"><div class="ps-sig-line">${escHtml(sig.name||'')}</div><div class="ps-sig-lbl">${escHtml(sig.label)}${sig.title?` — ${escHtml(sig.title)}`:''}</div></div>`).join('')}</div>`}
  `;
};

// Full in-app page, no pop-ups (owner directive) — prints via same-document
// window.print(). Wave 7 Pass 3 — rebuilt on window.openPage (the real
// page-stack primitive; see js/app.js's openPage) instead of a raw
// #page-content swap. That raw swap predated the page stack and destroyed
// whatever screen was showing underneath it (personal-finance, the worker-
// profile panel, …), which is why js/app.js's worker-profile Payslip button
// had to close its own panel FIRST via Overlay.dismissTop() before calling
// this — see that caller's comment (js/app.js, openWorkerProfilePanel). Now
// that this genuinely stacks like any other openPage panel, that pre-step
// is no longer required (left untouched here; app.js is out of scope for
// this pass — see the pass report for the suggested follow-up).
//
// Print/Save-as-JPEG/Transfer-Proof move into opts.headerRightHTML —
// openPage's own back arrow replaces the old hand-rolled "← Back" button,
// so there is one header, not two (8-point treatment #2/#6). `backFn` is
// wired as opts.onClose so it still fires exactly once on teardown, however
// the panel closes (Back button, a same-stack {replace:true} push, or
// Overlay.clearAll()) — the same contract every other backFn caller in this
// file already relies on.
// PAYSLIP-OVERHAUL-SPEC.md §1 — client-side gate for the "✎ Edit details"
// button. Deliberately narrower than hr.js's own canFinance/isFinancePriv()
// (= canEditDept('Finance'); note it no longer admits 'secretary' — the
// 2026-08-09 carve-out made canEditDept return false for them on Finance and
// IT — so the two predicates now differ only by Finance-DEPARTMENT members of
// any role, who are likewise not isMoneyAdmin): firestore.rules'
// isMoneyAdmin() — the actual write authority on payroll/{uid} and
// salary_history/{uid}_{month} — is president/manager/finance ONLY (WS19
// money-tier narrowing deliberately excludes secretary). Mirroring the
// broader canFinance gate here would show secretary a button whose Save
// always fails server-side; mirroring the real isMoneyAdmin() boundary
// instead keeps the UI honest AND matches the spec's own verification
// checklist ("secretary sees view-only"). Pure client-side UX — no rules
// change, no write path is loosened either way.
function _payslipCanEdit() {
  return ['president','manager','finance'].includes(window.currentRole);
}
window.renderPayslipPage = function(model, backFn, hostOpts) {
  hostOpts = hostOpts || {};
  const _canEdit = _payslipCanEdit();
  const headerRightHTML = `
    <button class="btn-primary btn-sm" id="ps-print-btn">${emojiIcon('🖨',16)} Print / Save PDF</button>
    <button class="btn-secondary btn-sm" id="ps-jpeg-btn">${emojiIcon('📷',16)} Save as JPEG</button>
    ${_canEdit?`<button class="btn-secondary btn-sm" id="ps-edit-btn">${emojiIcon('✎',16)} Edit details</button>`:''}
    ${model.proofUrl?`<a class="btn-secondary btn-sm" href="${safeHttpUrl(model.proofUrl)}" target="_blank">${emojiIcon('📎',16)} Transfer Proof</a>`:''}
  `;
  // CONFIDENTIALITY FIX (v14 HR remediation) — this panel is an openPage host
  // appended as a document.body-level SIBLING of #page-content, stacked over
  // whatever screen was open underneath (the payroll roster, HR Profiles
  // list, personal-finance, the worker-profile panel, …) — see the pass note
  // above. css/styles.css's base @media print block has
  // `#page-content,#page-content *{visibility:visible}` (added so a plain
  // Ctrl+P on roster/report screens works) with ID-selector specificity that
  // beats a bare `body *{visibility:hidden}` reset — so clicking Print/Save
  // PDF on ONE payslip printed this panel's `.payslip-print` content AND the
  // full underlying #page-content screen (e.g. the whole payroll table, every
  // employee's pay) in the same print job. That's a confidentiality breach:
  // an HR user asking for one worker's payslip must never leak every other
  // worker's salary onto the printed/PDF page.
  // Fix (js/-only — styles.css is out of scope for this pass, same
  // constraint openPayrollReconciliation's _reconPrintCss hit above): a
  // scoped inline <style> shipped with THIS panel's body that forces
  // #page-content hidden and only .payslip-print visible under print,
  // using !important to beat the ID-selector specificity tie the same way
  // _reconPrintCss already does for the reconciliation report. The multi-
  // payslip "Print All" flow (renderPayrollManagement's print-payroll-btn
  // handler) is untouched — it replaces #page-content's own contents with
  // every payslip directly, so #page-content legitimately IS the thing that
  // should print there.
  const _psPrintCss = `<style>
    @media print{
      #page-content,#page-content *{visibility:hidden!important}
      .payslip-print,.payslip-print *{visibility:visible!important}
    }
  </style>`;
  // PAYSLIP-OVERHAUL-SPEC.md §3 — the on-screen A4 sheet. .payslip-print
  // stays on the SAME div as .a4-sheet (not a wrapper around it) so the
  // confidentiality visibility rule above (`.payslip-print,.payslip-print
  // *{visibility:visible!important}`) still covers every descendant
  // unchanged; .a4-stage is a new OUTER container purely for centering +
  // the scale-to-fit transform (css/styles.css) and isn't targeted by that
  // rule at all — nothing in it needs to be, it has no content of its own.
  const bodyHTML = `${_psPrintCss}<div class="a4-stage"><div class="a4-sheet payslip-print">${buildPayslipHTML(model)}</div></div>`;
  let _fitCleanup = null;
  // §1's edit panel's Save handler re-renders this same payslip page with
  // {replace:true} so the fix is visible immediately, in the SAME stack
  // slot the edit panel was occupying (not stacked deeper) — forwarded here
  // as hostOpts.replace so a normal renderPayslipPage(model, backFn) call
  // (every existing caller) is untouched (replace defaults false).
  const panel = window.openPage(`${emojiIcon('🖨',16)} Payslip — ${escHtml(model.employee?.name||'')}`, bodyHTML, '', {
    headerRightHTML,
    replace: hostOpts.replace === true,
    onClose: () => { if (_fitCleanup) _fitCleanup(); if (backFn) backFn(); }
  });
  panel.querySelector('#ps-print-btn')?.addEventListener('click', (e) => _handlePayslipPrintOrPdf(model, panel, e.currentTarget));
  panel.querySelector('#ps-jpeg-btn')?.addEventListener('click', () => window.downloadPayslipJPEG(model, panel));
  panel.querySelector('#ps-edit-btn')?.addEventListener('click', () => window.openPayslipEditPanel && window.openPayslipEditPanel(model, backFn));
  if (window.lucide) lucide.createIcons({ nodes: [panel] });
  if (typeof window.fitA4Sheet === 'function') _fitCleanup = window.fitA4Sheet(panel);
  return panel;
};

// ═══════════════════════════════════════════════════════════
//  §1 — "✎ Edit details": the payslip is a RENDERING, not a second money
//  editor. This panel edits IDENTITY/GOV-ID fields ONLY, in place; money
//  already has three sanctioned pre-disburse editors (Edit Payroll modal,
//  Adjust modal, Give Raise) and this never duplicates their math — it only
//  deep-links to whichever applies for the run's current state.
//  buildPayslipHTML stays pure (model in -> HTML out).
//
//  Money-sensitivity hard constraints (PAYSLIP-OVERHAUL-SPEC.md §1/§8):
//   - NEVER write salary/allowance/deductions/sss/philhealth/pagibig/tax/
//     caDeducted/netPay/finalPay from here or ANY edit UI.
//   - The salary_history patch whitelist is EXACTLY {userName, tinNum,
//     ssNum, phNum, pagibigNum} — nothing else ever lands on that mirror
//     from this panel, monthly or weekly.
//   - js/money-core.js is never imported/called from this panel at all —
//     it has no money math to do.
//   - Every identity backfill is audit-logged (window.logAudit).
// ═══════════════════════════════════════════════════════════
// ── State-aware Section B signal (read-only lookups, no writes) ────────
// Split out of openPayslipEditPanel when that panel went window-first
// (v14.0.71) purely so its one read can be awaited from inside a try/catch
// WITHOUT re-indenting this chain: several branches below assign multi-line
// template literals whose continuation lines are HTML content, so shifting
// them would change the markup. Identical body, identical indentation, no
// writes anywhere in here.
async function _payslipEditSectionB(model, isWeekly) {
  let sectionBHtml, moneyLinkTarget = null; // moneyLinkTarget: 'projection'|'computed'|null(weekly uses weeklyStatus instead)
  let weeklyStatus = null;
  if (isWeekly) {
    if (model.sourceRef) {
      const psSnap = await db.collection('payslips').doc(model.sourceRef).get().catch(()=>null);
      weeklyStatus = psSnap?.exists ? (psSnap.data().status || 'draft') : null;
    }
    if (!model.sourceRef) {
      sectionBHtml = `<div style="font-size:11px;color:var(--text-muted)">This is an unsaved preview — pay figures come from the Payslip Generator and aren't on file yet.</div>`;
    } else if (weeklyStatus === 'submitted') {
      sectionBHtml = `<div class="badge badge-gray">${emojiIcon('🔒',12)} Submitted — figures locked</div>`;
    } else {
      sectionBHtml = `<button type="button" class="btn-secondary btn-sm" id="pe-money-link">Edit in Payslip Generator</button>
        <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Hours, rate, allowances, and deductions are edited from the Payslip Generator, not here.</div>`;
      moneyLinkTarget = 'weekly';
    }
  } else if (model.official) {
    sectionBHtml = `<div class="badge badge-gray">${emojiIcon('🔒',12)} Disbursed — figures locked</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px">This month is historical truth. A genuine correction goes through the President-approved delete (Finance → Payroll → Salary History), never an in-place edit.</div>`;
  } else {
    // Not yet disbursed — tell "computed run, not yet verified/disbursed"
    // apart from "pure live projection, no run yet" by checking pay_runs
    // directly (model itself can't reliably tell these apart — both build
    // through computePayLine as of §6, which always fills kpiScore/perfFactor).
    let isComputed = false;
    if (model.monthKey && model.sourceRef) {
      const runSnap = await db.collection('pay_runs').doc(model.monthKey).get().catch(()=>null);
      isComputed = !!(runSnap?.exists && (runSnap.data().lines||[]).some(l => l.uid === model.sourceRef));
    }
    moneyLinkTarget = isComputed ? 'computed' : 'projection';
    sectionBHtml = `<button type="button" class="btn-secondary btn-sm" id="pe-money-link">${isComputed ? 'Adjust this computed line' : 'Edit live pay settings'}</button>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Opens Finance → Payroll — use ${isComputed ? "this employee's row ✎ Adjust button" : "this employee's row ✎ Edit button"} to change pay figures.</div>`;
  }
  return { sectionBHtml, moneyLinkTarget };
}

window.openPayslipEditPanel = async function(model, backFn) {
  if (!_payslipCanEdit()) return; // defensive — the button itself is already gated
  const isWeekly = model.kind === 'weekly';

  // ── WINDOW FIRST, DATA SECOND (v14.0.71) ────────────────────────────────
  // Section B needs one Firestore read (payslips/{sourceRef} for weekly,
  // pay_runs/{monthKey} for monthly) before it can say whether the figures are
  // locked or where they are edited — and openPage used to wait for it, so
  // tapping "✎ Edit details" changed nothing on screen until it landed. The
  // panel now opens synchronously with a skeleton body.
  //
  // The title is built from `model`, which the caller already holds, so it is
  // final at open time and never has to be rewritten. Save ships disabled
  // until the real form exists; Cancel is inline onclick and live immediately.
  // NOTHING about what this panel writes changes — the salary_history patch
  // whitelist and the per-target try/catch below are untouched.
  const panel = openPage(`${emojiIcon('✎',16)} Edit details — ${escHtml(model.employee.name||'')}`,
    window.skeletonHtml('rows', 5),
    `<button class="btn-primary" id="pe-save-btn" disabled>Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  const bodyEl = panel.querySelector('.page-panel-body');

  let sectionBHtml, moneyLinkTarget = null;
  try {
    ({ sectionBHtml, moneyLinkTarget } = await _payslipEditSectionB(model, isWeekly));
  } catch (err) {
    // FAILURE PATH — both reads in there carry their own .catch, so this only
    // fires on something unexpected; without it that would leave the (now
    // already-open) window on an eternal skeleton.
    if (panel.isConnected) _hrPanelError(bodyEl, err);
    return;
  }
  // CLOSED MID-FLIGHT — Back before the read landed.
  if (!panel.isConnected) return;

  const idLabel = isWeekly ? 'Worker ID (BI-W-###)' : 'Employee ID';
  const nameLabel = isWeekly ? 'Worker Name' : 'Name';
  const bodyHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">${emojiIcon('🪪',14)} Identity and government-ID fields only, backfilled here so blank cells on the payslip can be corrected without hunting through ${isWeekly?'the worker profile':'Edit Payroll'}. Pay figures (base/allowance/deductions/statutory/CA/net) are never edited on this panel — see "Pay figures" below for where they actually live.</div>
    <div style="font-weight:700;font-size:13px;margin-bottom:8px">Employee &amp; Government IDs</div>
    <div class="form-group"><label>${nameLabel}</label><input id="pe-name" value="${escHtml(model.employee.name)}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Job Title</label><input id="pe-title" value="${escHtml(model.employee.jobTitle)}"/></div>
      <div class="form-group"><label>Department</label><input id="pe-dept" value="${escHtml(model.employee.department)}"/></div>
    </div>
    <div class="form-group"><label>${idLabel}</label><input id="pe-empid" value="${escHtml(model.employee.idNumber)}"/></div>
    <div class="form-row">
      <div class="form-group"><label>TIN</label><input id="pe-tin" value="${escHtml(model.employee.tin)}" placeholder="000-000-000-000"/></div>
      <div class="form-group"><label>SSS No.</label><input id="pe-sss" value="${escHtml(model.employee.sss)}" placeholder="00-0000000-0"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>PhilHealth No.</label><input id="pe-ph" value="${escHtml(model.employee.philhealth)}"/></div>
      <div class="form-group"><label>Pag-IBIG MID</label><input id="pe-pib" value="${escHtml(model.employee.pagibig)}"/></div>
    </div>
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
      <div style="font-weight:700;font-size:13px;margin-bottom:8px">Pay figures</div>
      ${sectionBHtml}
    </div>
  `;

  // The panel was pushed at the top of this function (a stacked push,
  // replace:false, per §1's implementation shape — it sits on top of the
  // payslip panel; the payslip panel itself is only replaced once Save
  // actually persists something, via renderPayslipPage's hostOpts.replace
  // wired below). All that happens here is the skeleton giving way to the
  // real form.
  bodyEl.innerHTML = bodyHTML;
  // Byte-identical settled footer: `<button class="btn-primary"
  // id="pe-save-btn">Save</button>`.
  panel.querySelector('#pe-save-btn')?.removeAttribute('disabled');
  // emojiIcon('🪪')/('🔒') in the markup above emit `<i data-lucide>`, and
  // openPage's sweep ran while the body was still a skeleton.
  if (window.lucide) lucide.createIcons({ nodes: [panel] });

  // ── LISTENERS AFTER THE FILL ────────────────────────────────────────────
  // #pe-money-link lives in the body that only just landed, so this binding
  // has to be here; #pe-save-btn is in the footer but is bound here too, so it
  // can never run against a form that does not exist.
  panel.querySelector('#pe-money-link')?.addEventListener('click', () => {
    Notifs.showToast('Opening Payroll — pay figures are edited there, never on the payslip itself.');
    if (moneyLinkTarget === 'weekly') {
      // Weekly = Type B. Route through the hub so the tab bar comes back with
      // the screen (the old call rendered a bare, tab-less Worker Profiles).
      if (typeof window.renderPayrollHub === 'function') window.renderPayrollHub(deptContainer(), window.currentUser, window.currentRole, 'B');
      else navigateTo('dept:HR');
    } else if (typeof window.renderFinance === 'function') {
      window.renderFinance(window.currentUser, window.currentRole, 'Payroll');
    } else {
      navigateTo('dept:Finance');
    }
  });

  panel.querySelector('#pe-save-btn')?.addEventListener('click', () => window.busy(panel.querySelector('#pe-save-btn'), async () => {
    // ID formats are free-text (existing convention, no validation beyond
    // trim — matches the Edit Payroll modal's own gov-ID inputs, hr.js).
    const name  = panel.querySelector('#pe-name')?.value.trim()  || '';
    const title = panel.querySelector('#pe-title')?.value.trim() || '';
    const dept  = panel.querySelector('#pe-dept')?.value.trim()  || '';
    const empId = panel.querySelector('#pe-empid')?.value.trim()|| '';
    const tin   = panel.querySelector('#pe-tin')?.value.trim()   || '';
    const sss   = panel.querySelector('#pe-sss')?.value.trim()   || '';
    const ph    = panel.querySelector('#pe-ph')?.value.trim()    || '';
    const pib   = panel.querySelector('#pe-pib')?.value.trim()   || '';
    if (!name) { Notifs.showToast('Name is required.', 'error'); return; }

    // Per-target try/catch — firestore.rules gates users/{uid} (Name/
    // Department/Job Title/Employee ID: isSeniorAdmin — president/manager
    // ONLY) more tightly than payroll/{uid} (TIN/SSS/PhilHealth/Pag-IBIG:
    // isMoneyAdmin — president/manager/finance). A finance-role save can
    // legitimately succeed on one target and be denied on the other; each
    // write is isolated so a denial on one never silently swallows (or
    // blocks) the other, and the toast reports exactly what did/didn't save
    // — never a single opaque "failed" with no explanation.
    const results = [];
    const attempt = async (label, fn) => {
      try { await fn(); results.push({ label, ok:true }); }
      catch (err) { console.error(`payslip edit panel: "${label}" save failed`, err); results.push({ label, ok:false, err }); }
    };

    if (isWeekly) {
      if (model.profileId) {
        await attempt('Identity & gov IDs (worker profile)', () => db.collection('worker_profiles').doc(model.profileId).set({
          name, jobTitle: title, department: dept, idNumber: empId,
          tinNum: tin, ssNum: sss, phNum: ph, pagibigNum: pib
        }, { merge:true }));
        window.logAudit && window.logAudit('payslip-id-backfill', 'worker_profiles', model.profileId,
          { fields:['name','jobTitle','department','idNumber','tinNum','ssNum','phNum','pagibigNum'] });
      }
      // A saved payslips doc (draft OR submitted) gets the same identity
      // patch — money stays locked by not being in this write at all, not
      // by a status check (§1's weekly row in the editable-fields matrix).
      if (model.sourceRef) {
        await attempt('Saved payslip record', () => db.collection('payslips').doc(model.sourceRef).set({
          workerName: name, tinNum: tin, ssNum: sss, phNum: ph, pagibigNum: pib
        }, { merge:true }));
      }
    } else {
      const uid = model.sourceRef;
      if (uid) {
        await attempt('Name / Department / Job Title / Employee ID', () => db.collection('users').doc(uid).set({
          displayName: name, title, department: dept, employeeId: empId
        }, { merge:true }));
        await attempt('TIN / SSS / PhilHealth / Pag-IBIG', () => db.collection('payroll').doc(uid).set({
          tinNum: tin, ssNum: sss, phNum: ph, pagibigNum: pib
        }, { merge:true }));
        window.logAudit && window.logAudit('payslip-id-backfill', 'users', uid,
          { fields:['displayName','title','department','employeeId','tinNum','ssNum','phNum','pagibigNum'] });
        if (model.official && model.monthKey) {
          // §8 hard constraint — the ONLY salary_history patch whitelist:
          // {userName, tinNum, ssNum, phNum, pagibigNum}. NEVER salary/
          // allowance/deductions/sss/philhealth/pagibig/tax/caDeducted/
          // netPay/finalPay from this panel.
          await attempt('Disbursed record (salary_history mirror)', () => db.collection('salary_history').doc(`${uid}_${model.monthKey}`).set({
            userName: name, tinNum: tin, ssNum: sss, phNum: ph, pagibigNum: pib
          }, { merge:true }));
          window.logAudit && window.logAudit('payslip-id-backfill', 'salary_history', `${uid}_${model.monthKey}`,
            { fields:['userName','tinNum','ssNum','phNum','pagibigNum'] });
        }
      }
    }

    if (!results.length) { Notifs.showToast('Nothing to save — this payslip has no writable record on file yet.', 'error'); return; }
    const failed = results.filter(r => !r.ok);
    const anyPermissionDenied = failed.some(f => f.err && (f.err.code === 'permission-denied' || /permission/i.test(f.err.message||'')));
    if (failed.length === results.length) {
      Notifs.showToast(`Could not save (${failed.map(f=>f.label).join(', ')})${anyPermissionDenied ? ' — you may need President/Manager access for some of these fields.' : '.'}`, 'error');
      return;
    }
    if (failed.length) {
      Notifs.showToast(`Saved: ${results.filter(r=>r.ok).map(r=>r.label).join('; ')}. Could NOT save: ${failed.map(f=>f.label).join('; ')}${anyPermissionDenied ? ' (needs President/Manager).' : '.'}`, 'error');
    } else {
      Notifs.success('Details updated.');
    }

    // Re-render the payslip with the fix visible immediately (§1: "re-run
    // the model build + re-render the payslip page, replace:true"). Every
    // OTHER call site's original raw source object isn't reachable from
    // here, so this updates the model's display fields from exactly what
    // was just confirmed persisted (never from what merely got typed) and
    // re-renders in place — money fields on `model` are untouched, since
    // nothing above ever wrote money.
    const okLabels = new Set(results.filter(r=>r.ok).map(r=>r.label));
    const identityOk = isWeekly
      ? okLabels.has('Identity & gov IDs (worker profile)') || okLabels.has('Saved payslip record')
      : okLabels.has('Name / Department / Job Title / Employee ID') || okLabels.has('TIN / SSS / PhilHealth / Pag-IBIG');
    if (identityOk) {
      if (!isWeekly && okLabels.has('Name / Department / Job Title / Employee ID')) {
        model.employee.name = name; model.employee.jobTitle = title;
        model.employee.department = dept; model.employee.idNumber = empId;
      } else if (isWeekly && okLabels.has('Identity & gov IDs (worker profile)')) {
        model.employee.name = name; model.employee.jobTitle = title;
        model.employee.department = dept; model.employee.idNumber = empId;
      }
      if (okLabels.has('TIN / SSS / PhilHealth / Pag-IBIG') || okLabels.has('Saved payslip record') || okLabels.has('Identity & gov IDs (worker profile)')) {
        model.employee.tin = tin; model.employee.sss = sss;
        model.employee.philhealth = ph; model.employee.pagibig = pib;
      }
    }
    window.renderPayslipPage(model, backFn, { replace:true });
  }));
};

// ═══════════════════════════════════════════════════════════
//  §4 — Print / Save PDF + Save as JPEG (payslip overhaul)
//  Root causes fixed here (see PAYSLIP-OVERHAUL-SPEC.md §4):
//   1. Save-as-JPEG loaded html2canvas from cdnjs, which index.html's CSP
//      script-src does NOT allowlist — the dynamic <script> load failed on
//      EVERY device (not just iOS), with no try/catch, leaving the button
//      stuck on "Generating…" forever.
//   2. window.print() is a no-op/unreliable inside an iOS Add-to-Home-Screen
//      standalone webview (no browser chrome to host the print sheet); the
//      old JPEG fallback's data-URL link.click() is separately unreliable
//      in standalone mode too.
//  Fix: vendor html2canvas locally (js/vendor/html2canvas.min.js, same-origin
//  — CSP 'self' allows it, works offline via sw.js's PRECACHE), capture to a
//  Blob, and hand the file to the native Web Share sheet on iOS standalone
//  (Save Image / Save to Files / AirPrint / Mail) with a same-repo
//  dependency-free JPEG→PDF wrapper (js/pdf-lite.js) for the PDF path.
//  Desktop/Android/regular-Safari keep window.print(). No pop-ups, no new
//  window, no cross-origin script — fully same-document.
// ═══════════════════════════════════════════════════════════

let _html2canvasLoadPromise = null;
function _ensureHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve();
  if (_html2canvasLoadPromise) return _html2canvasLoadPromise;
  _html2canvasLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/html2canvas.min.js';
    s.onload = () => resolve();
    s.onerror = () => { _html2canvasLoadPromise = null; reject(new Error('Could not load the export library — check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return _html2canvasLoadPromise;
}
let _pdfLiteLoadPromise = null;
function _ensurePdfLite() {
  if (window.jpegToPdf) return Promise.resolve();
  if (_pdfLiteLoadPromise) return _pdfLiteLoadPromise;
  _pdfLiteLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/pdf-lite.js';
    s.onload = () => resolve();
    s.onerror = () => { _pdfLiteLoadPromise = null; reject(new Error('Could not load the PDF export helper.')); };
    document.head.appendChild(s);
  });
  return _pdfLiteLoadPromise;
}

function _isIOSStandalone() {
  try {
    const ua = navigator.userAgent || '';
    const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints||0) > 1);
    const standalone = window.navigator.standalone === true
      || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    return isIOS && standalone;
  } catch (_) { return false; }
}

// One capture pipeline (§4 point 2). Clones `.payslip-print` (the SAME div
// that carries `.a4-sheet`) at scale 1 off-viewport — html2canvas honors CSS
// transforms inconsistently, so the LIVE scaled element is never captured
// directly (spec: clone-capture, it's deterministic) — captures at scale:2
// for print sharpness, removes the clone. `panelEl` scopes the query to a
// specific panel (defensive — payslip panels can theoretically stack via
// {replace:true}); falls back to a bare document query, same as before.
//
// SCROLL-LOCK IMMUNITY (mobile window model): the payslip is rendered inside a
// page-panel, so on the phone shell window.ScrollLock is HELD while these
// buttons are reachable — <body> carries `position:fixed; top:-Npx;
// overflow:hidden`. html2canvas clones the document into an offscreen iframe
// INCLUDING body's inline style, and derives its capture window from live
// window scroll offsets; a negatively-offset, overflow-hidden, out-of-flow body
// is exactly the shape that produces blank/clipped/shifted captures. Rather
// than measure whether this particular version of html2canvas survives it, we
// make the lock provably ABSENT for the duration: ScrollLock.withUnlocked()
// fully releases (whatever the refcount), runs the capture against a normal
// scrollable document at the original scroll offset, then re-applies the lock
// at the SAME offset — in a finally, so a throwing capture cannot strand the
// app unlocked. The optional-chained bind + identity fallback keeps this a
// no-op on any load order where config.js has not defined ScrollLock yet
// (and on desktop, where nothing ever acquires), so the capture path never
// depends on the window model being present.
//
// The ensure-loaded step stays OUTSIDE the unlocked window on purpose: it is a
// network/script fetch that can take arbitrarily long, and there is no reason to
// leave the document scrollable behind an open panel while it runs.
async function capturePayslipCanvas(panelEl, opts) {
  opts = opts || {};
  await _ensureHtml2Canvas();
  const run = window.ScrollLock?.withUnlocked?.bind(window.ScrollLock) || (fn => fn());
  return await run(async () => {
    const root = panelEl || document;
    const src = root.querySelector('.payslip-print');
    if (!src) throw new Error('Could not find the payslip content to capture.');
    const clone = src.cloneNode(true);
    clone.style.transform = 'none'; // neutralize the live scale-to-fit transform — capture at true 1x
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:-99999px;top:0;background:#fff;';
    wrap.appendChild(clone);
    document.body.appendChild(wrap);
    try {
      return await window.html2canvas(clone, { scale: opts.scale || 2, useCORS:true, backgroundColor:'#fff', logging:false });
    } finally {
      wrap.remove();
    }
  });
}

function _canvasToJpegBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not render the image.')), 'image/jpeg', 0.92);
  });
}

// Save as JPEG (§4 point 3) — Blob + Web Share (files) when available
// (iOS standalone: Save Image/Save to Files/AirDrop/Messages/Print — the
// reliable, user-visible-success path); otherwise a plain Blob-URL anchor
// download (never a data: URL — those are separately unreliable in iOS
// standalone per the root-cause note above). Every failure surfaces via a
// toast; the button ALWAYS comes back off "Generating…" (finally), so it
// can never get stuck — the exact symptom this replaces.
window.downloadPayslipJPEG = async function(model, panelEl) {
  const root = panelEl || document;
  const btn = root.querySelector ? root.querySelector('#ps-jpeg-btn') : document.getElementById('ps-jpeg-btn');
  const origLabel = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    let canvas = await capturePayslipCanvas(panelEl);
    let blob;
    try {
      blob = await _canvasToJpegBlob(canvas);
    } catch (_) {
      // huge-canvas fallback — cap scale to 1 and retry once (§4 edge case).
      canvas = await capturePayslipCanvas(panelEl, { scale: 1 });
      blob = await _canvasToJpegBlob(canvas);
    }
    const fname = `${(model.docNumber||'payslip').replace(/[^a-zA-Z0-9-]/g,'')}.jpg`;
    const file = new File([blob], fname, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Payslip — ${model.employee?.name||''}` });
      } catch (shareErr) {
        if (!shareErr || shareErr.name !== 'AbortError') throw shareErr; // AbortError = user cancelled, not a failure
      }
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = fname; link.href = url; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  } catch (err) {
    console.error('downloadPayslipJPEG failed', err);
    Notifs.showToast('Could not generate the JPEG — ' + (err && err.message ? err.message : 'please try again.'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel || `${emojiIcon('📷',16)} Save as JPEG`; }
  }
};

// Print / Save PDF (§4 point 4). iOS standalone only: capture → JPEG →
// wrap in a single-page A4 PDF (js/pdf-lite.js) → share sheet (Save to
// Files / Print / Mail). Every other platform keeps window.print() — the
// existing confidentiality-scoped print CSS + styles.css print blocks
// already work correctly in desktop/regular-mobile browsers.
async function sharePayslipPDF(model, panelEl) {
  await _ensurePdfLite();
  const canvas = await capturePayslipCanvas(panelEl);
  const blob = await _canvasToJpegBlob(canvas);
  const jpegBuf = await blob.arrayBuffer();
  const pdfBytes = window.jpegToPdf(jpegBuf, canvas.width, canvas.height);
  const fname = `${(model.docNumber||'payslip').replace(/[^a-zA-Z0-9-]/g,'')}.pdf`;
  const file = new File([pdfBytes], fname, { type: 'application/pdf' });
  if (!(navigator.canShare && navigator.canShare({ files: [file] }))) {
    const e = new Error('SHARE_UNAVAILABLE'); e.code = 'SHARE_UNAVAILABLE'; throw e;
  }
  await navigator.share({ files: [file], title: `Payslip — ${model.employee?.name||''}` });
}

async function _handlePayslipPrintOrPdf(model, panelEl, btnEl) {
  if (!_isIOSStandalone()) { window.print(); return; }
  const origLabel = btnEl ? btnEl.innerHTML : '';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Generating…'; }
  try {
    await sharePayslipPDF(model, panelEl);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      // user cancelled the share sheet — not a failure, swallow silently.
    } else if (err && err.code === 'SHARE_UNAVAILABLE') {
      // Old-iOS last resort (§4 point 4c): attempt native print anyway, and
      // point the user at the JPEG button which has its own fallback path.
      Notifs.showToast('Sharing isn’t available on this device — trying Print, or use Save as JPEG instead.', 'error');
      try { window.print(); } catch (_) {}
    } else {
      console.error('sharePayslipPDF failed', err);
      Notifs.showToast('Could not generate the PDF — ' + (err && err.message ? err.message : 'please try again.'), 'error');
    }
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = origLabel || `${emojiIcon('🖨',16)} Print / Save PDF`; }
  }
}

// PAYSLIP-OVERHAUL-SPEC.md §3 — scales every `.a4-stage` inside `root` so its
// `.a4-sheet` (fixed 794×1123 "paper") always fits the available width with
// no horizontal scroll, phone or desktop, by setting the `--a4-scale` custom
// property the CSS transform reads. `root` is normally an openPage panel
// (uses `.page-panel-body`'s width); Print-All (hr.js) passes `#page-content`
// with `{live:false}` — a one-shot fit with no persistent resize listener,
// since that screen fully replaces its DOM on the next navigation anyway and
// a live listener there would leak on every "Print All" click. The panel
// case IS live (resize/orientationchange) and returns a cleanup fn that
// renderPayslipPage chains into its onClose.
window.fitA4Sheet = function(root, opts) {
  opts = opts || {};
  if (!root) return () => {};
  const recalc = () => {
    const stages = root.querySelectorAll ? root.querySelectorAll('.a4-stage') : [];
    stages.forEach(stage => {
      const bodyEl = stage.closest('.page-panel-body') || stage.parentElement || root;
      const w = (bodyEl && bodyEl.clientWidth) || root.clientWidth || window.innerWidth;
      const scale = Math.max(0.1, Math.min(1, (w - 16) / 794));
      stage.style.setProperty('--a4-scale', String(scale));
      // Reserve the sheet's ACTUAL scaled height, not one hardcoded A4 page.
      // transform:scale() does not shrink the layout box, so the stage has to
      // stand in for the visual size — and it was standing in for 1123px even
      // when the payslip ran to two pages, which made a long sheet paint over
      // whatever followed it (in the Print-All batch: the next person's
      // payslip). offsetHeight is the untransformed layout height, so this is
      // the true unscaled paper length.
      const sheet = stage.querySelector('.a4-sheet');
      if (sheet && sheet.offsetHeight) stage.style.setProperty('--a4-h', sheet.offsetHeight + 'px');
    });
  };
  recalc();
  if (opts.live === false) return () => {};
  window.addEventListener('resize', recalc);
  window.addEventListener('orientationchange', recalc);
  return () => {
    window.removeEventListener('resize', recalc);
    window.removeEventListener('orientationchange', recalc);
  };
};
