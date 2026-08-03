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
   threeWayReconTableHTML/openPayrollReconciliation), Payroll Management
   (renderPayrollManagement, incl. its nested loadPayrollTable/
   loadPayRunStrip and Payroll History table), and the HR Profiles +
   Worker Payslip suite (nextWorkerIdNumber/syncWorkerDirectory/
   ensureWorkerVerifyToken/openWorkerIDModal/batchPrintWorkerIDs/
   renderFinanceHRProfiles/openHRProfileForm/openWorkerKioskModal/
   PAYSLIP_STAGES/payslipStageBadge/openPayslipHistory/openPayslipEdit/
   openPayslipGenerator/computeDayHours/collectPayslipData/
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

// ── Salary Raise (shared by Payroll + HR Profiles) ─
// Applies a raise immediately and logs it to salary_raises (old→new, %, effective
// date, reason, who granted it). Finance/admin only; an affected app-user can read
// their own raise records (firestore.rules mirrors the salary_history gate).
function openSalaryRaiseModal({ subjectType, subjectId, subjectName, fieldLabel, targetField, current }, currentUser, onDone) {
  const cur = parseFloat(current) || 0;
  const _isPres = typeof isRealPresident === 'function' && isRealPresident();
  openPage(`${emojiIcon('💸',16)} Give Raise — ${escHtml(subjectName||'')}`, `
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

  const newInp = document.getElementById('raise-new');
  const amtInp = document.getElementById('raise-amt');
  const pctInp = document.getElementById('raise-pct');
  const prev   = document.getElementById('raise-preview');
  // Button text is date/role aware (v12 WS23): a future-dated raise SCHEDULES
  // rather than applies, even for the President.
  const _btnLabel = () => {
    const effM = (document.getElementById('raise-eff')?.value || today()).slice(0,7);
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
  document.getElementById('raise-eff').addEventListener('change', () => {
    const b = document.getElementById('raise-save-btn'); if (b) b.textContent = _btnLabel();
  });

  document.getElementById('raise-save-btn').addEventListener('click', async () => {
    const nv = parseFloat(newInp.value) || 0;
    if (nv <= 0)    { Notifs.showToast('Enter a valid new amount','error'); return; }
    if (nv === cur) { Notifs.showToast('New amount is unchanged','error'); return; }
    const reason = document.getElementById('raise-reason').value.trim();
    const eff    = document.getElementById('raise-eff').value || today();
    const btn = document.getElementById('raise-save-btn');
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
  const snap = await db.collection('salary_raises').orderBy('createdAt','desc').limit(200).get().catch(()=>({docs:[]}));
  let list = snap.docs.map(d=>({id:d.id,...d.data()}));
  if (opts.subjectId) list = list.filter(r => r.subjectId === opts.subjectId);
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
  openPage(`${emojiIcon('💸',16)} Salary Raise History${opts.subjectName?` — ${escHtml(opts.subjectName)}`:''}`, rows,
    `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
}

// Admin list of scheduled + pending-approval raises (the SCHEDULE half of the
// lifecycle — openRaiseHistory above stays the immutable APPLIED log).
window.openScheduledRaises = async function() {
  const snap = await db.collection('pending_raises').where('status','in',['scheduled','pending_approval']).get().catch(()=>({docs:[]}));
  const list = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.effectiveDate||'').localeCompare(b.effectiveDate||''));
  const isPres = typeof isRealPresident === 'function' && isRealPresident();
  const render = () => {
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
    // replace:true — this is a self-refresh (approve/reject re-invoke render()
    // in place); openPage falls back to a normal push on the very first call
    // (empty stack), then swaps itself in place on every re-render after.
    openPage(`${emojiIcon('💸',16)} Scheduled &amp; Pending Raises`, rows, `<button class="btn-secondary" onclick="closeModal()">Close</button>`, {replace:true});
    document.querySelectorAll('.sr-approve-btn').forEach(btn=>btn.addEventListener('click', async ()=>{
      const r = await window.RaiseFlow.approve(btn.dataset.id);
      Notifs.showToast(r==='approved'?'Raise approved.':'Already resolved.');
      window.openScheduledRaises();
    }));
    document.querySelectorAll('.sr-reject-btn').forEach(btn=>btn.addEventListener('click', async ()=>{
      const reason = (await promptDialog({message:'Reason for declining (optional):', multiline:true}))||'';
      await window.RaiseFlow.reject(btn.dataset.id, reason);
      Notifs.error('Raise declined.');
      window.openScheduledRaises();
    }));
  };
  render();
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
  const cards = [
    { icon:'👥', title:'People & Roles', desc:'Assign roles, departments & employee class', go:()=>navigateTo('team-directory') },
    { icon:'💰', title:'Payroll',        desc:'Monthly run — Compute → Verify → Disburse', go:()=>window.renderFinance(currentUser, currentRole, 'Payroll') },
    { icon:'👷', title:'Worker Payslips',desc:'Weekly Production payslips, profiles & ID cards', go:()=>window.renderFinance(currentUser, currentRole, 'HR Profiles') },
    ...(canAccounts ? [{ icon:'🔑', title:'Accounts & Logins', desc:'Create worker logins, reset passwords, edit pay', go:()=>navigateTo('team') }] : []),
    { icon:'🌴', title:'Leave',          desc:'Requests, approvals & balances',             go:()=>window.renderLeavePage && window.renderLeavePage() },
    { icon:'🕐', title:'Attendance',     desc:'Daily attendance & time-extension requests', go:()=>navigateTo('attendance') },
  ];
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('👥',20)} Human Resources</h2></div>
    ${window.sopPanel('How HR works', [
      'People & Roles — set each person’s role, department(s) and employee class (Regular monthly vs Production weekly).',
      'Payroll — run the monthly cycle: Compute the figures, Verify them, then mark Disbursed once salaries are released (finalize by the 5th).',
      'Worker Payslips — generate weekly payslips for Production workers (hourly attendance, fixed weekly rate).',
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
    const ledgerAmt  = Object.prototype.hasOwnProperty.call(ledgerByUid, uid) ? ledgerByUid[uid] : null;
    const payrunNet  = line ? (line.finalPay ?? null) : null;
    const historyNet = hist ? (hist.finalPay ?? hist.netPay ?? null) : null;

    const missing = [];
    if (ledgerAmt  == null) missing.push('LEDGER');
    if (payrunNet  == null) missing.push('PAYRUN');
    if (historyNet == null) missing.push('HISTORY');

    let status, delta = null;
    if (missing.length) {
      status = 'MISSING-IN-' + missing.join('/');
    } else {
      const vals = [ledgerAmt, payrunNet, historyNet];
      delta = Math.round((Math.max(...vals) - Math.min(...vals)) * 100) / 100;
      status = delta > 0.01 ? 'MISMATCH' : 'OK';
    }
    return { month, uid, name, ledgerAmt, payrunNet, historyNet, status, delta };
  }).sort((a,b) => a.name.localeCompare(b.name));
}

function threeWayReconTableHTML(rows) {
  if (!rows.length) return `<div class="empty-state" style="padding:20px"><p style="color:var(--text-muted)">No payroll data found for this month in any of the three sources.</p></div>`;
  const statusBadge = r => r.status === 'OK'
    ? `<span class="badge badge-green">OK</span>`
    : r.status === 'MISMATCH'
      ? `<span class="badge badge-red">MISMATCH${r.delta!=null?` &nbsp;Δ ₱${fmt(r.delta)}`:''}</span>`
      : `<span class="badge badge-orange">${escHtml(r.status)}</span>`;
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Employee</th><th>Ledger Amt</th><th>Payrun Net</th><th>History Net</th><th>Status</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td style="font-weight:600">${escHtml(r.name)}</td>
      <td style="white-space:nowrap;font-size:12px">${r.ledgerAmt!=null?`₱${fmt(r.ledgerAmt)}`:'<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="white-space:nowrap;font-size:12px">${r.payrunNet!=null?`₱${fmt(r.payrunNet)}`:'<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="white-space:nowrap;font-size:12px">${r.historyNet!=null?`₱${fmt(r.historyNet)}`:'<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="white-space:nowrap">${statusBadge(r)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ── Payroll reconciliation report (Part E Phase 20) — READ-ONLY. President-
// only. For every pay_run month, diffs ledger PAY- rows against the frozen
// run lines and salary_history mirror, flagging: (a) more than one PAY
// ledger row for the same month+uid, (b) a ledger amount that doesn't match
// the frozen run's netPay/finalPay, (c) salary_history rows with no
// matching frozen line (the pre-lock era's Path-B fingerprint). No writes —
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
  openPage(`${emojiIcon('🔍',16)} Payroll Reconciliation`,
    `${_reconPrintCss}
    <div class="recon-print-wrap">
      <div class="recon-print-lh">${_reconLh ? _reconLh.headerHTML : ''}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <h4 style="margin:0">Three-Way Reconciliation — ledger vs pay run vs salary history</h4>
        <div class="no-print" style="display:flex;gap:8px;align-items:center">
          <select id="recon3-month-sel" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px"></select>
          <button class="btn-secondary btn-sm" id="recon3-csv-btn" disabled>${emojiIcon('📥',14)} Export CSV</button>
        </div>
      </div>
      <div id="recon3-body" style="padding:20px;text-align:center;color:var(--text-muted)">${window.skeletonHtml('table')}</div>
      <hr style="margin:22px 0;border-color:var(--border)"/>
      <h4 style="margin:0 0 10px">All-Time Flag Scan</h4>
      <div id="recon-body" style="padding:20px;text-align:center;color:var(--text-muted)">Scanning payroll history…</div>
      <div class="recon-print-lh">${_reconLh ? _reconLh.footerHTML : ''}</div>
    </div>`,
    `<button class="btn-secondary" onclick="window.print()">${emojiIcon('🖨',16)} Print</button><button class="btn-secondary" id="recon-csv-btn" disabled>Export CSV (flags)</button><button class="btn-secondary" onclick="closeModal()">Close</button>`);

  const runsSnap = await db.collection('pay_runs').get().catch(()=>({docs:[]}));
  const runDataByMonth = {}; runsSnap.docs.forEach(d => { runDataByMonth[d.id] = d.data(); });
  const runs = runsSnap.docs.map(d=>({ month:d.id, ...d.data() })).filter(r => r.lines && r.lines.length);

  // ── Three-way section: month picker + diff table for the selected month ──
  const allMonths = runsSnap.docs.map(d=>d.id).sort().reverse();
  const monthSel = document.getElementById('recon3-month-sel');
  if (monthSel) {
    monthSel.innerHTML = allMonths.length
      ? allMonths.map(m => `<option value="${m}">${escHtml(window.fmtMonthLabel ? window.fmtMonthLabel(m) : m)}</option>`).join('')
      : `<option value="">No pay runs yet</option>`;
  }
  let recon3Rows = [];
  const loadThreeWay = async (month) => {
    const body3 = document.getElementById('recon3-body');
    const csv3  = document.getElementById('recon3-csv-btn');
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
  document.getElementById('recon3-csv-btn')?.addEventListener('click', () => window.exportCSV('payroll-reconciliation-3way-' + (monthSel?.value||''), recon3Rows, [
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
  const body = document.getElementById('recon-body');
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

  const csvBtn = document.getElementById('recon-csv-btn');
  if (csvBtn) {
    csvBtn.disabled = !flags.length;
    csvBtn.addEventListener('click', () => window.exportCSV('payroll-reconciliation', flags, [
      { key:'month', label:'Month' }, { key:'uid', label:'Employee UID' }, { key:'name', label:'Employee' },
      { key:'issue', label:'Issue' }, { key:'detail', label:'Detail' }, { key:'ledgerAmt', label:'Ledger Amount' }, { key:'runAmt', label:'Run Amount' }
    ]));
  }
}

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
  const [usersSnap, histSnap, delReqSnap] = await Promise.all([
    fetchUsersWithPayroll(),
    db.collection('salary_history').orderBy('month','desc').limit(200).get().catch(()=>({docs:[]})),
    db.collection('payroll_delete_requests').where('status','==','pending').get().catch(()=>({docs:[]}))
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
  // Production-class staff are paid WEEKLY via Worker Payslips (HR → Payslips),
  // NOT in the monthly run. Excluding them here is the single-source fix that
  // stops a production worker being paid both weekly AND monthly (double pay).
  const productionStaff = allStaff.filter(u=>u.payClass==='production');
  const employees = allStaff.filter(u=>u.payClass!=='production')
    .sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  const history   = histSnap.docs.map(d=>({id:d.id,...d.data()}));
  const delReqs   = delReqSnap.docs.map(d=>({id:d.id,...d.data()}));
  const pendingDelIds = new Set(delReqs.map(r=>r.historyId));
  const canFinance = isFinancePriv();
  const isPres     = isRealPresident(currentUser);
  const months    = [...new Set(history.map(h=>h.month))].sort().reverse();
  const thisMonth = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10)).slice(0,7); // Manila YYYY-MM

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
      <select id="pr-month-sel" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px">
        <option value="${thisMonth}">${window.fmtMonthLabel(thisMonth)} (Current)</option>
        ${months.filter(m=>m!==thisMonth).map(m=>`<option value="${m}">${window.fmtMonthLabel(m)}</option>`).join('')}
      </select>
      <div style="display:flex;gap:8px">
        <button class="btn-primary btn-sm" id="gen-payroll-btn">Compute Payroll</button>
        <button class="btn-secondary btn-sm" id="raise-history-btn">${emojiIcon('💸',16)} Raise History</button>
        <button class="btn-secondary btn-sm" id="print-payroll-btn">${emojiIcon('🖨',16)} Print All</button>
        ${(typeof isRealPresident === 'function' && isRealPresident()) ? `<button class="btn-secondary btn-sm" id="payroll-recon-btn">${emojiIcon('🔍',16)} Reconciliation</button>` : ''}
      </div>
    </div>
    ${raiseBanner}
    <div id="pay-run-strip" style="margin-bottom:14px"></div>
    ${productionStaff.length?`<div style="font-size:12px;color:var(--text-2);background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:12px">${emojiIcon('🏭',16)} <strong>${productionStaff.length}</strong> production-class worker${productionStaff.length!==1?'s are':' is'} paid <strong>weekly</strong> via Worker Payslips (HR → Payslips) and ${productionStaff.length!==1?'are':'is'} excluded from this monthly run to avoid double payment.</div>`:''}
    <div class="card">
      <div class="card-body" style="padding:0">
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
        openPage(`Edit Payroll Record — ${escHtml(rec.userName||'?')} (${escHtml(rec.month||'?')})`, `
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

        document.getElementById('save-hpe-btn').addEventListener('click', async () => {
          // H2 fix — every other money-posting path guards on assertPeriodOpen
          // before writing; this edit modal didn't, so a closed month could be
          // silently re-posted. Mirrors the try/catch-return pattern used elsewhere
          // (assertPeriodOpen already shows its own toast on rejection).
          try { await window.assertPeriodOpen(rec.month + '-01'); } catch (e) { return; }
          const salary    = parseFloat(document.getElementById('hpe-salary').value)||0;
          const allowance = parseFloat(document.getElementById('hpe-allow').value)||0;
          const deductions= parseFloat(document.getElementById('hpe-deduct').value)||0;
          const netPay    = parseFloat(document.getElementById('hpe-net').value)||0;
          const finalPay  = parseFloat(document.getElementById('hpe-final').value)||0;
          const notes     = document.getElementById('hpe-notes').value.trim();
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
          const effectiveGross = netPay + statutoryTotal + deductions;
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
              icon: '🗑', type: 'payroll_delete_request'
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
              icon: '✅', type: 'payroll_delete_approved'
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
              icon: '❌', type: 'payroll_delete_denied'
            });
          }
          Notifs.error('Request denied and requester notified.');
          loadFinanceContent(currentUser, currentRole, 'Payroll');
        });
      });
    }
  }

  // Per-employee CA plan (WS22's CashAdvance.planFor), read by both the table
  // preview and the Edit Payroll modal — one shared computation, not two.
  let _planByUser = {};

  async function loadPayrollTable(month) {
    const tbody = document.getElementById('payroll-tbody');
    tbody.innerHTML = '<tr><td colspan="14" style="padding:14px 20px"><div class="skl-text" style="width:92%"></div></td></tr>'.repeat(3);

    const statYear = window.bizYear ? window.bizYear() : new Date().getFullYear();
    const plans = await Promise.all(employees.map(u => window.CashAdvance
      ? window.CashAdvance.planFor(u.id, month)
      : Promise.resolve({ caBalance:0, mode:'full', caPlanned:0, plan:[] })));
    _planByUser = {};
    employees.forEach((u,i) => { _planByUser[u.id] = plans[i]; });

    tbody.innerHTML = employees.map(u => {
      const depts    = (Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—';
      const base     = u.salary||0;
      const allow    = u.allowance||0;
      const gross    = base + allow;
      // Hand-typed value wins; otherwise WS21's statutory table suggests the amount
      // (the "Auto-computed if 0" placeholder text is finally backed by real math).
      const sug      = window.computeStatutory ? window.computeStatutory({ grossPay: gross, year: statYear }) : null;
      const sss      = u.sss        || (sug ? sug.ee.sss : 0);
      const ph       = u.philhealth || (sug ? sug.ee.philhealth : 0);
      const pagibig  = u.pagibig    || (sug ? sug.ee.pagibig : 0);
      const tax      = u.tax        || (sug ? sug.ee.tax : 0);
      const plan     = _planByUser[u.id] || { caBalance:0, mode:'full', caPlanned:0, plan:[] };
      const caBalance= plan.caBalance;
      const caAdv    = plan.caPlanned;
      const deduct   = (u.deductions||0) + sss + ph + pagibig + tax;
      const net      = gross - deduct - caAdv;
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
          <button class="btn-secondary btn-sm edit-emp-pay-btn" data-uid="${u.id}" title="Edit" aria-label="Edit payroll">${emojiIcon('✎',16)}</button>
          ${canFinance ? `<button class="btn-secondary btn-sm raise-emp-btn" data-uid="${u.id}" title="Give raise" aria-label="Give raise">${emojiIcon('banknote',14)}</button>` : ''}
          <button class="btn-secondary btn-sm print-slip-btn" data-uid="${u.id}" title="Payslip" aria-label="Print payslip">${emojiIcon('🖨',16)}</button>
        </td>
      </tr>`;
    }).join('');
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

    tbody.querySelectorAll('.edit-emp-pay-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid  = btn.dataset.uid;
        const emp  = employees.find(u=>u.id===uid);
        const plan = _planByUser[uid] || { caBalance:0, mode:'full', caPlanned:0, plan:[] };
        const caBalance = plan.caBalance;
        if (!emp) return;

        const statYear = window.bizYear ? window.bizYear() : new Date().getFullYear();
        const sug = window.computeStatutory ? window.computeStatutory({ grossPay: (emp.salary||0)+(emp.allowance||0), year: statYear }) : null;
        const unverifiedBadge = sug && sug.unverified ? ` <span style="font-size:10px;color:var(--warning)">${emojiIcon('⚠',10)} unverified rates</span>` : '';
        const inst = plan.plan[0]; // first CA in the plan, for the "installment N of M" label

        const _payClass = emp.payClass==='production' ? 'production' : 'regular';
        openPage(`Edit Payroll — ${escHtml(emp.displayName||'')}`, `
          <div class="form-group"><label>Employee Class</label>
            <select id="ep-class" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
              <option value="regular" ${_payClass==='regular'?'selected':''}>Regular — monthly (KPI + attendance)</option>
              <option value="production" ${_payClass==='production'?'selected':''}>Production — weekly, fixed rate (hourly attendance, 8-hr day)</option>
            </select>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Regular staff are paid monthly here; Production workers are paid weekly via the Payslip generator.</div>
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
            <div class="form-group"><label>SSS${unverifiedBadge}</label><input id="ep-sss" type="number" value="${emp.sss||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.sss):'0.00'}" inputmode="decimal"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>PhilHealth</label><input id="ep-ph" type="number" value="${emp.philhealth||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.philhealth):'0.00'}" inputmode="decimal"/></div>
            <div class="form-group"><label>Pag-IBIG</label><input id="ep-pi" type="number" value="${emp.pagibig||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.pagibig):'0.00'}" inputmode="decimal"/></div>
          </div>
          <div class="form-group"><label>Tax</label><input id="ep-tax" type="number" value="${emp.tax||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.tax):'0.00'}" inputmode="decimal"/></div>
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
          ${caBalance > 0 ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <label style="font-weight:600">${emojiIcon('💳',16)} Cash Advance — Outstanding ₱${fmt(caBalance)}${inst?` · Installment ${inst.installmentNo} of ${inst.terms}`:''}</label>
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                <input type="radio" name="ep-ca-mode" value="installment" ${plan.mode!=='full'?'checked':''}/>
                This month's installment — ₱${fmt(plan.caPlanned)}
              </label>
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                <input type="radio" name="ep-ca-mode" value="full" ${plan.mode==='full'?'checked':''}/>
                Pay off full balance — ₱${fmt(caBalance)}
              </label>
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                <input type="radio" name="ep-ca-mode" value="custom"/>
                Custom amount
                <input id="ep-ca-custom" type="number" min="0" max="${caBalance}" step="0.01" style="width:120px;margin-left:4px" placeholder="0.00"/>
              </label>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Remaining after this payroll: ₱<span id="ep-ca-remaining">${fmt(Math.max(0,caBalance-plan.caPlanned))}</span></div>
          </div>` : ''}
        `, `<button class="btn-primary" id="save-ep-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

        if (caBalance > 0) {
          const updateRemaining = () => {
            const mode   = document.querySelector('input[name="ep-ca-mode"]:checked')?.value || 'installment';
            const custom = parseFloat(document.getElementById('ep-ca-custom')?.value)||0;
            const amt    = mode==='full' ? caBalance : mode==='custom' ? Math.min(custom, caBalance) : plan.caPlanned;
            document.getElementById('ep-ca-remaining').textContent = fmt(Math.max(0, caBalance-amt));
          };
          document.querySelectorAll('input[name="ep-ca-mode"]').forEach(r=>r.addEventListener('change', updateRemaining));
          document.getElementById('ep-ca-custom')?.addEventListener('input', () => {
            const radio = document.querySelector('input[name="ep-ca-mode"][value="custom"]');
            if (radio) radio.checked = true;
            updateRemaining();
          });
        }

        document.getElementById('save-ep-btn').addEventListener('click', () => window.busy(document.getElementById('save-ep-btn'), async () => {
          // All pay — base, allowance, and government deductions — lives in the
          // protected payroll/{uid} doc (finance/admin write), not the users doc.
          // v12 WS23 — base salary is NOT writable here (approval-routed via 💸
          // Give Raise instead); this modal only edits allowance/deductions/statutory.
          await db.collection('payroll').doc(uid).set({
            payClass:   document.getElementById('ep-class')?.value === 'production' ? 'production' : 'regular',
            allowance:  parseFloat(document.getElementById('ep-allow').value)||0,
            deductions: parseFloat(document.getElementById('ep-deduct').value)||0,
            sss:        parseFloat(document.getElementById('ep-sss').value)||0,
            philhealth: parseFloat(document.getElementById('ep-ph').value)||0,
            pagibig:    parseFloat(document.getElementById('ep-pi').value)||0,
            tax:        parseFloat(document.getElementById('ep-tax').value)||0,
            // v12 WS39 — statutory IDs (alphalist/2316 prerequisite). Free-text,
            // same field names as worker_profiles so toPayslipModel reads one
            // vocabulary across both payroll cycles.
            tinNum:     document.getElementById('ep-tin')?.value.trim()   || '',
            ssNum:      document.getElementById('ep-ssnum')?.value.trim() || '',
            phNum:      document.getElementById('ep-phnum')?.value.trim() || '',
            pagibigNum: document.getElementById('ep-pagnum')?.value.trim()|| '',
          }, {merge:true});
          if (emp) emp.payClass = document.getElementById('ep-class')?.value === 'production' ? 'production' : 'regular';
          window.logAudit && window.logAudit('update','payroll',uid,{ allowance:parseFloat(document.getElementById('ep-allow').value)||0 });

          // Override tracking (v12 WS21 decision 4) — flag divergence from the
          // computed suggestion for later audit review; never blocks the save.
          if (sug) {
            [['sss',sug.ee.sss,'ep-sss'],['philhealth',sug.ee.philhealth,'ep-ph'],['pagibig',sug.ee.pagibig,'ep-pi'],['tax',sug.ee.tax,'ep-tax']]
              .forEach(([field, computed, elId]) => {
                const typed = parseFloat(document.getElementById(elId).value)||0;
                if (typed && Math.abs(typed-computed) > 0.01) {
                  window.logAudit && window.logAudit('statutory-override','payroll',uid,{ field, computed, entered: typed });
                }
              });
          }

          // Cash-advance choice for THIS run (v12 WS22). Writes payroll_ca_overrides
          // as the transition mechanism — CashAdvance.planFor() reads it ahead of
          // WS20's frozen pay_runs.lines[i].caPlan on the next Compute.
          if (caBalance > 0) {
            const mode = document.querySelector('input[name="ep-ca-mode"]:checked')?.value || 'installment';
            const overrideRef = db.collection('payroll_ca_overrides').doc(`${uid}_${month}`);
            if (mode === 'installment') {
              await overrideRef.delete().catch(()=>{}); // revert to the plan default
            } else {
              const amount = mode === 'full' ? caBalance : Math.min(parseFloat(document.getElementById('ep-ca-custom')?.value)||0, caBalance);
              await overrideRef.set({ userId:uid, month, amount, setBy:currentUser.uid, setAt:firebase.firestore.FieldValue.serverTimestamp() });
            }
          }

          closeModal(); Notifs.success('Payroll updated!');
          loadPayrollTable(month);
        }));
      });
    });
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
      if(!(await confirmDialog({message:`Mark ${month} payroll as VERIFIED? This confirms the computed amounts have been checked.`}))) return;
      await db.collection('pay_runs').doc(month).set({ state:'verified', verifiedBy:currentUser.uid, verifiedByName:window.userProfile?.displayName||currentUser.email, verifiedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      window.logAudit && window.logAudit('update','pay_run',month,{state:'verified'});
      Notifs.success('Payroll marked verified.'); loadPayRunStrip(month);
    });
    // Disburse — v12 WS20 D6: THE single mutating step (CA deducted, ledger
    // posted, salary_history frozen, employees notified). Terminal afterward.
    document.getElementById('pr-disburse-btn')?.addEventListener('click', async ()=>{
      const chk = await db.collection('pay_runs').doc(month).get().catch(()=>null);
      const data2 = (chk && chk.exists) ? chk.data() : {};
      const bankOpts = await window.BankAccounts.optionsHTML();
      openModal(`Disburse ${month} payroll`, `
        <p style="font-size:13px;margin-bottom:10px">₱${fmt(data2.totalNet||0)} to ${data2.employeeCount||0} staff. This deducts cash advances, posts the ledger, and notifies employees. <strong>This cannot be undone.</strong></p>
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
        loadPayRunStrip(month);
        loadFinanceContent(currentUser, currentRole, 'Payroll');
      });
    });
    // Reopen — president-only, verified → computed (v12 WS20 D5).
    document.getElementById('pr-reopen-btn')?.addEventListener('click', async ()=>{
      if(!(await confirmDialog({message:`Reopen ${month} payroll for editing? This returns it to Computed — Verify again before Disburse.`}))) return;
      await window.reopenPayRun(month);
      loadPayRunStrip(month);
    });
    // Resume a stuck 'disbursing' run — idempotent re-run of disbursePayRun
    // via the deterministic PAY-{month}-{uid} refs (Part E Phase 11).
    document.getElementById('pr-resume-btn')?.addEventListener('click', async ()=>{
      if(!(await confirmDialog({message:`Resume disbursing ${month} payroll? This safely re-runs the disburse step — already-posted rows are updated in place, not duplicated.`}))) return;
      const acct = await window.BankAccounts.pick(null).catch(()=>({ bankAccountId:null, bankAccountName:null }));
      try { await window.disbursePayRun(month, { bankAccount: acct }); Notifs.success('Payroll disbursed!'); }
      catch (err) { Notifs.showToast(err.message || 'Could not resume disbursement.', 'error'); }
      loadPayRunStrip(month);
      loadFinanceContent(currentUser, currentRole, 'Payroll');
    });
    // Manual unlock of a stuck 'disbursing' run — president-only, routes
    // through reopenPayRun's disbursing→computed branch (Part E Phase 11).
    document.getElementById('pr-unlock-btn')?.addEventListener('click', async ()=>{
      if(!(await confirmDialog({message:`Unlock ${month} payroll? Only do this after confirming the disburse step actually failed/stalled — this returns the run to Computed.`, danger:true}))) return;
      await window.reopenPayRun(month);
      loadPayRunStrip(month);
    });
  }

  loadPayrollTable(thisMonth);
  loadPayRunStrip(thisMonth);
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
      model = window.toPayslipModel({...line, month}, 'monthly');
      model.official = runDoc.data().state === 'disbursed';
      model.payDateLabel = runDoc.data().disbursedAt ? new Date(runDoc.data().disbursedAt.toDate()).toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}) : '';
    } else {
      // Interim projection — no computed line for this month yet.
      const emp = employees.find(u=>u.id===b.dataset.uid);
      if (!emp) return;
      model = window.toPayslipModel({ ...emp, uid:emp.id, month, base:emp.salary }, 'monthly');
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
    const models = await Promise.all(lines.map(async l => {
      const mdl = window.toPayslipModel({...l, month}, 'monthly');
      mdl.official = official;
      mdl.ytd = await window.payslipYtdMonthly(l.uid, year);
      return mdl;
    }));
    const host = document.getElementById('page-content');
    host.innerHTML = `
      <div class="no-print" style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
        <button class="btn-secondary btn-sm" id="ps-back-btn">← Back</button>
        <button class="btn-primary btn-sm" onclick="window.print()">${emojiIcon('🖨',16)} Print All</button>
      </div>
      ${models.map(mdl => `<div class="payslip-print" style="page-break-after:always">${window.buildPayslipHTML(mdl)}</div>`).join('')}`;
    if (window.lucide) lucide.createIcons({ nodes: [host] });
    document.getElementById('ps-back-btn').addEventListener('click', () => window.renderFinance(currentUser, currentRole, 'Payroll'));
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
  await db.collection('id_verify').doc(token).set(proj);
  await db.collection('worker_profiles').doc(profile.id).set({ verifyToken: token }, { merge:true });
  profile.verifyToken = token;
  return token;
}

window.openWorkerIDModal = async function(profile, onDone) {
  if (!profile) return;
  const token = await ensureWorkerVerifyToken(profile).catch(()=>null);
  const url = (window.BRAND?.verifyBase || '/v/') + '?' + encodeURIComponent(token||'');
  const qr = (window.buildQRSVG && token) ? window.buildQRSVG(url, 120) : '';
  openPage(`${emojiIcon('🪪',16)} Worker ID — ` + escHtml(profile.name||''), `
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
  `, `<button class="btn-primary" id="wid-print">${emojiIcon('🖨',16)} Print / Save PDF</button><button class="btn-secondary" onclick="closeModal()">Close</button>`);
  document.getElementById('wid-print')?.addEventListener('click', () => {
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
    ${isPriv?`<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn-primary btn-sm" id="hrp-add-btn">+ Add Worker Profile</button>
      <button class="btn-secondary btn-sm" id="hrp-payslip-history-btn">${emojiIcon('📄',16)} All Payslips</button>
      <button class="btn-secondary btn-sm" id="hrp-raise-history-btn">${emojiIcon('💸',16)} Raise History</button>
      <button class="btn-secondary btn-sm" id="hrp-batch-id-btn">${emojiIcon('🪪',16)} Batch Print IDs</button>
      <button class="btn-secondary btn-sm" id="hrp-sync-dir-btn">↻ Sync Directory</button>
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
                <button class="btn-primary btn-sm hrp-gen-btn" data-id="${p.id}" style="margin-right:4px">${emojiIcon('📄',16)} Payslip</button>
                <button class="btn-secondary btn-sm hrp-id-btn" data-id="${p.id}" style="margin-right:4px">${emojiIcon('🪪',16)} ID</button>
                ${isPriv?`<button class="btn-secondary btn-sm hrp-kiosk-btn" data-id="${p.id}" title="Record today's time in/out" style="margin-right:4px">${emojiIcon('⏱',16)} Clock</button>`:''}
                ${isPriv?`<button class="btn-secondary btn-sm hrp-raise-btn" data-id="${p.id}" title="Give raise" style="margin-right:4px">${emojiIcon('💸',16)} Raise</button>`:''}
                ${isPriv?`<button class="btn-secondary btn-sm hrp-edit-btn" data-id="${p.id}">${emojiIcon('✎',16)} Edit</button>`:''}
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

  // Add profile
  if (isPriv) {
    document.getElementById('hrp-add-btn')?.addEventListener('click', () => openHRProfileForm(null, currentUser, currentRole, ()=>renderFinanceHRProfiles(container,currentUser,currentRole)));
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
  }

  // Generate payslip
  container.querySelectorAll('.hrp-gen-btn').forEach(btn => {
    const profile = profiles.find(p=>p.id===btn.dataset.id);
    btn.addEventListener('click', () => openPayslipGenerator(profile, currentUser, currentRole));
  });
}

function openHRProfileForm(profile, currentUser, currentRole, onSave) {
  const isEdit = !!profile;
  const depts = ['Barro Kitchens','Barro Industries','Brilliant Steel','Finance','HR','Operations','General'];
  const empTypes = ['Regular','Part-time','Contractual','Project-based'];
  const workTypes = ['Onsite','Online','Hybrid','Remote'];

  openPage(`${isEdit?'Edit':'Add'} Worker Profile`, `
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
      <div class="form-group" style="display:flex;align-items:center;padding-top:22px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
          <input type="checkbox" id="hrp-include-payroll" ${profile?.includeInPayroll!==false?'checked':''} style="width:18px;height:18px"/>
          Include in Payroll
        </label>
      </div>
    </div>
    <div class="form-group">
      <label>Linked Login Account (uid) — optional</label>
      <input id="hrp-linked-uid" value="${escHtml(profile?.linkedUid||'')}" placeholder="Only if this worker ALSO has a users/ login account"/>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">v12 WS20: set this if the worker is paid weekly here AND has a regular-staff login — the monthly payroll run hard-skips this uid to prevent double pay.</div>
    </div>
  `, `<button class="btn-primary" id="hrp-save-btn">${isEdit?'Update':'Save'} Profile</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  // Stable doc id (pre-allocate for new profiles so the photo path is known).
  const profileId = profile?.id || db.collection('worker_profiles').doc().id;
  let uploadedPhotoUrl = profile?.photoUrl || '';

  document.getElementById('hrp-gen-id')?.addEventListener('click', async () => {
    const btn = document.getElementById('hrp-gen-id'); btn.disabled = true; btn.textContent = '…';
    try { document.getElementById('hrp-id').value = await window.nextWorkerIdNumber(); }
    catch(e){ Notifs.showToast('Could not generate ID number','error'); }
    btn.disabled = false; btn.textContent = 'Generate';
  });

  document.getElementById('hrp-photo-file')?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const st = document.getElementById('hrp-photo-status'); st.textContent = 'Uploading…';
    try {
      uploadedPhotoUrl = await window.Drive.uploadWorkerPhoto(f, profileId);
      document.getElementById('hrp-photo-prev').innerHTML = `<img src="${escHtml(uploadedPhotoUrl)}" style="width:100%;height:100%;object-fit:cover"/>`;
      st.textContent = '✅ Photo uploaded';
    } catch(err){ st.textContent = '❌ ' + (err.message||'Upload failed'); }
  });

  document.getElementById('hrp-save-btn').addEventListener('click', async () => {
    const name = document.getElementById('hrp-name').value.trim();
    if (!name) { Notifs.showToast('Name is required','error'); return; }
    const data = {
      name,
      idNumber: document.getElementById('hrp-id').value.trim(),
      photoUrl: uploadedPhotoUrl || '',
      jobTitle: document.getElementById('hrp-title').value.trim(),
      department: document.getElementById('hrp-dept').value,
      employmentType: document.getElementById('hrp-emptype').value,
      workType: document.getElementById('hrp-worktype').value,
      // v12 WS23 — dailyRate/hourlyRate are read-only in edit mode (change via
      // 💸 Raise instead); the inputs don't exist in the DOM then, so omit them
      // from the write entirely rather than reading a null element.
      ...(isEdit ? {} : {
        dailyRate: parseFloat(document.getElementById('hrp-daily').value)||0,
        hourlyRate: parseFloat(document.getElementById('hrp-hourly').value)||0,
      }),
      foodAllowance: parseFloat(document.getElementById('hrp-food').value)||0,
      issuedOn: document.getElementById('hrp-issued').value,
      allowances: {
        meal: parseFloat(document.getElementById('hrp-meal').value)||0,
        transport: parseFloat(document.getElementById('hrp-transport').value)||0,
      },
      ssNum: document.getElementById('hrp-sss').value.trim(),
      phNum: document.getElementById('hrp-ph').value.trim(),
      pagibigNum: document.getElementById('hrp-pib').value.trim(),
      tinNum: document.getElementById('hrp-tin').value.trim(),
      address: document.getElementById('hrp-addr').value.trim(),
      phone: document.getElementById('hrp-phone').value.trim(),
      status: document.getElementById('hrp-status').value,
      caBalance: parseFloat(document.getElementById('hrp-ca-balance').value)||0,
      includeInPayroll: document.getElementById('hrp-include-payroll').checked,
      linkedUid: document.getElementById('hrp-linked-uid').value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!isEdit) { data.createdAt = firebase.firestore.FieldValue.serverTimestamp(); data.createdBy = currentUser.uid; }
    await db.collection('worker_profiles').doc(profileId).set(data, { merge: true });
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

// v12 WS26 — HR-operated kiosk: record a worker_profile's time in/out for today.
// Writes attendance_worker/{profileId}/records/{bizDate()} (NOT attendance/{uid} —
// factory worker_profiles have no Firebase Auth login yet). Reuses the existing
// computeDayHours(timeIn,timeOut) helper (same one the payslip time-log uses) so
// the hours math never drifts between kiosk entry and manual payslip entry.
function openWorkerKioskModal(profile, currentUser) {
  const label = escHtml(profile.name || 'Worker');
  openModal(`${emojiIcon('⏱',16)} Clock — ${label}`, `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Recording time for <strong>${label}</strong> on ${bizDate()}.</div>
    <div class="form-row">
      <div class="form-group"><label>Time In</label><input id="kiosk-time-in" type="time" value="07:00"/></div>
      <div class="form-group"><label>Time Out</label><input id="kiosk-time-out" type="time" value="16:00"/></div>
    </div>
  `, `<button class="btn-primary" id="kiosk-save-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

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

// Payslip workflow: draft → verified → filed → submitted (sequential, no skipping)
const PAYSLIP_STAGES = ['draft','verified','filed','submitted'];
function payslipStageBadge(status) {
  return { draft:'badge-gray', verified:'badge-blue', filed:'badge-orange', submitted:'badge-green' }[status] || 'badge-gray';
}

async function openPayslipHistory(currentUser, currentRole) {
  const canAct = ['president','owner','manager','finance'].includes(currentRole);
  const snap = await db.collection('payslips').orderBy('createdAt','desc').limit(100).get().catch(()=>({docs:[]}));
  const list = snap.docs.map(d=>({id:d.id,...d.data()}));

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
    // replace:true — self-refresh (advance/delete/override re-invoke renderModal()
    // in place, same top-of-stack). The edit sub-page (ps-edit-btn) does NOT come
    // back through here — see its own onSave callback below, which pops back via
    // Overlay.clearAll() instead so the stale hidden copy of this page isn't left
    // behind under the edit page.
    const panel = openPage(`${emojiIcon('📄',16)} Payslip Summary`, `
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
    `, '', {replace:true});
    if (window.lucide) lucide.createIcons({ nodes: [panel] });
    bindRows();
  };

  const bindRows = () => {
    document.querySelectorAll('.ps-view-btn').forEach(btn => {
      const ps = list.find(p=>p.id===btn.dataset.id);
      btn.addEventListener('click', async () => {
        if (!ps) return;
        const model = window.toPayslipModel(ps, 'weekly');
        model.ytd = await window.payslipYtdWeekly(ps.workerId, (ps.payPeriodStart||'').slice(0,4) || (window.bizYear?window.bizYear():new Date().getFullYear()));
        window.renderPayslipPage(model, () => renderFinanceHRProfiles(deptContainer(), currentUser, currentRole));
      });
    });
    document.querySelectorAll('.ps-advance-btn').forEach(btn => onClickSafe(btn, async () => {
        const ps = list.find(p=>p.id===btn.dataset.id);
        const next = btn.dataset.next;
        if (!ps || !next) return;
        if (!(await confirmDialog({message:`Mark ${escHtml(ps.workerName)}'s payslip (${ps.payPeriodStart} – ${ps.payPeriodEnd}) as "${next}"?`, html:true}))) return;
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
        if (next === 'submitted') {
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
    document.querySelectorAll('.ps-edit-btn').forEach(btn => onClickSafe(btn, () => {
        const ps = list.find(p=>p.id===btn.dataset.id);
        // openPayslipEdit pushes ON TOP of this summary page (a real drill-in,
        // not a self-refresh), so its onSave can't just call renderModal()
        // {replace:true} — that would only pop the edit page and leave THIS
        // page's now-stale earlier copy hidden underneath. clearAll() + a fresh
        // open collapses both back to one entry, mirroring the task-edit pattern.
        if (ps) openPayslipEdit(ps, currentUser, () => { window.Overlay.clearAll(); openPayslipHistory(currentUser, currentRole); });
    }));
    document.querySelectorAll('.ps-del-btn').forEach(btn => onClickSafe(btn, async () => {
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
    document.querySelectorAll('.ps-override-btn').forEach(btn => onClickSafe(btn, async () => {
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

  renderModal();
}

// Compact edit of a filed payslip's amounts (recomputes net; keeps ledger in sync).
function openPayslipEdit(ps, currentUser, onSave) {
  const r = ps.regular||{}, ot = ps.overtime||{}, al = ps.allowances||{}, g = ps.deductions?.govt||{}, o = ps.deductions?.other||{};
  openPage(`${emojiIcon('✎',16)} Edit Payslip — ${escHtml(ps.workerName||'')}`, `
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${ps.payPeriodStart||''} – ${ps.payPeriodEnd||''}</div>
    <div class="form-row">
      <div class="form-group"><label>Rate / HR (₱)</label><input id="pe-rph" type="number" step="0.01" value="${r.ratePerHr||0}" inputmode="decimal"/></div>
      <div class="form-group"><label>Hours Worked</label><input id="pe-hrs" type="number" step="0.01" value="${r.hrsWorked||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Overtime Pay (₱)</label><input id="pe-ot" type="number" value="${ot.total||0}" inputmode="decimal"/></div>
      <div class="form-group"><label>Allowances total (₱)</label><input id="pe-allow" type="number" value="${al.total||0}" inputmode="decimal"/></div>
    </div>
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

  const num = id => parseFloat(document.getElementById(id).value)||0;
  const recompute = () => {
    const gross = num('pe-rph')*num('pe-hrs') + num('pe-ot') + num('pe-allow');
    const ded = num('pe-sss')+num('pe-ph')+num('pe-pib')+num('pe-ca')+num('pe-loans')+num('pe-tax');
    document.getElementById('pe-net').textContent = 'Net: ₱'+fmt(gross - ded - num('pe-paid'));
  };
  ['pe-rph','pe-hrs','pe-ot','pe-allow','pe-sss','pe-ph','pe-pib','pe-ca','pe-loans','pe-tax','pe-paid']
    .forEach(id => document.getElementById(id).addEventListener('input', recompute));

  document.getElementById('pe-save-btn').addEventListener('click', () => window.busy(document.getElementById('pe-save-btn'), async () => {
    const rph=num('pe-rph'), hrs=num('pe-hrs'), otT=num('pe-ot'), alT=num('pe-allow');
    const sss=num('pe-sss'), ph=num('pe-ph'), pib=num('pe-pib'), ca=num('pe-ca'), loans=num('pe-loans'), tax=num('pe-tax'), paid=num('pe-paid');
    const reg = parseFloat((rph*hrs).toFixed(2));
    const govTotal=sss+ph+pib, otherTotal=ca+loans+tax;
    const grossPay = reg+otT+alT, totalDeductions = govTotal+otherTotal;
    const totalPay = grossPay-totalDeductions, netPay = totalPay-paid;
    await db.collection('payslips').doc(ps.id).update({
      'regular.ratePerHr':rph, 'regular.hrsWorked':hrs, 'regular.dailyRate':parseFloat((rph*8).toFixed(2)), 'regular.total':reg,
      'overtime.total':otT, 'allowances.total':alT, 'allowances.meal':alT,
      'deductions.govt.sss':sss, 'deductions.govt.philhealth':ph, 'deductions.govt.pagibig':pib, 'deductions.govt.total':govTotal,
      'deductions.other.cashAdvance':ca, 'deductions.other.loans':loans, 'deductions.other.taxes':tax, 'deductions.other.total':otherTotal,
      grossPay, totalDeductions, totalPay, paid, netPay,
      editedBy: currentUser.uid, editedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Keep the general-ledger entry in sync if it was already posted
    const lsnap = await db.collection('ledger').where('refNumber','==',`WPAY-${ps.id}`).limit(1).get().catch(()=>({docs:[]}));
    if (lsnap.docs.length) await lsnap.docs[0].ref.update({ amount: netPay });
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
    closeModal();
    Notifs.success('Payslip updated.');
    onSave && onSave();
  }));
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

  openPage(`${emojiIcon('📄',16)} Generate Payslip — ${escHtml(profile.name||'')}`, `
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
          <th style="text-align:left;padding:4px">Day</th><th style="padding:4px">Time In</th><th style="padding:4px">Time Out</th><th style="padding:4px">Hours</th>
        </tr></thead>
        <tbody>
          ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=>`<tr>
            <td style="padding:4px">${d}</td>
            <td style="padding:4px"><input id="ps-tin-${i}" type="time" class="ps-time-input" value="${d==='Sun'?'':'07:00'}" style="width:100%;padding:4px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text)"/></td>
            <td style="padding:4px"><input id="ps-tout-${i}" type="time" class="ps-time-input" value="${d==='Sun'?'':(d==='Sat'?'18:00':'16:00')}" style="width:100%;padding:4px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text)"/></td>
            <td style="padding:4px;text-align:center;font-weight:600" id="ps-dayhrs-${i}">0.00</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;font-size:12px">
        Computed Total: <strong style="margin-left:6px" id="ps-computed-total">0.00</strong>&nbsp;hrs
      </div>
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
  `, `
    <button class="btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn-secondary" id="ps-preview-btn">${emojiIcon('👁',16)} Preview</button>
    <button class="btn-primary" id="ps-save-btn">${emojiIcon('💾',16)} Save &amp; Generate</button>
  `);

  // Bind proof upload area
  let proofFile = null;
  if (window.Drive?.renderUploadArea) {
    Drive.renderUploadArea('ps-proof-area', r => { proofFile = r; }, { label:'Upload transfer screenshot/photo', dept:'Finance', subfolder:'payslips' });
  }

  // ── Auto-compute hours from daily time log (−1hr lunch if shift spans 12–1PM) ──
  let foodEdited = false;
  document.getElementById('ps-meal')?.addEventListener('input', () => { foodEdited = true; });
  const recomputeHours = () => {
    let total = 0, daysOver4 = 0;
    for (let i = 0; i < 7; i++) {
      const hrs = computeDayHours(
        document.getElementById(`ps-tin-${i}`)?.value,
        document.getElementById(`ps-tout-${i}`)?.value
      );
      const cell = document.getElementById(`ps-dayhrs-${i}`);
      if (cell) cell.textContent = hrs.toFixed(2);
      total += hrs;
      if (hrs > 4) daysOver4++;
    }
    const totalEl = document.getElementById('ps-computed-total');
    if (totalEl) totalEl.textContent = total.toFixed(2);
    const hrsInput = document.getElementById('ps-hrs');
    if (hrsInput) hrsInput.value = total.toFixed(2);
    // Food allowance: profile rate × number of days exceeding 4 hrs (unless manually overridden)
    const foodInput = document.getElementById('ps-meal');
    if (foodInput && !foodEdited) foodInput.value = ((profile.foodAllowance||0) * daysOver4).toFixed(2);
  };
  document.querySelectorAll('.ps-time-input').forEach(inp => inp.addEventListener('input', recomputeHours));
  recomputeHours();

  // ── v12 WS26: pull HR-kiosk-recorded worker attendance (attendance_worker/{profile.id}/records)
  // into this SAME time-log table so HR doesn't re-key hours already clocked at the kiosk.
  // This ONLY prefills ps-tin-{i}/ps-tout-{i} then calls the existing recomputeHours() — rows
  // stay editable, and collectPayslipData/the WPAY- ledger post on Submit are untouched.
  document.getElementById('ps-load-kiosk-btn')?.addEventListener('click', async () => {
    const start = document.getElementById('ps-start').value, end = document.getElementById('ps-end').value;
    if (!start || !end) { Notifs.showToast('Set pay period dates first','error'); return; }
    const snap = await db.collection('attendance_worker').doc(profile.id).collection('records')
      .where(firebase.firestore.FieldPath.documentId(), '>=', start)
      .where(firebase.firestore.FieldPath.documentId(), '<=', end).get().catch(()=>({docs:[]}));
    const byDow = {}; // Mon..Sun index 0..6
    snap.docs.forEach(d => { const r = d.data(); const dow = window.bizDow(new Date(`${r.date}T12:00:00`)); byDow[(dow+6)%7] = r; });
    for (let i=0;i<7;i++){ const r=byDow[i]; if(!r) continue;
      const tin=document.getElementById(`ps-tin-${i}`), tout=document.getElementById(`ps-tout-${i}`);
      if(tin) tin.value=r.timeIn||''; if(tout) tout.value=r.timeOut||''; }
    recomputeHours();
    Notifs.showToast('Loaded kiosk hours — review & adjust before saving.');
  });

  // ── Live CA remaining-balance preview ──
  const updateCaRemaining = () => {
    const balance = profile.caBalance || 0;
    const deduct  = parseFloat(document.getElementById('ps-ca')?.value) || 0;
    const remain  = Math.max(0, balance - deduct);
    const el = document.getElementById('ps-ca-remaining-display');
    if (el) el.textContent = fmt(remain);
  };
  document.getElementById('ps-ca')?.addEventListener('input', updateCaRemaining);

  document.getElementById('ps-preview-btn').addEventListener('click', async () => {
    const d = collectPayslipData(profile, currentUser);
    if (!d) return;
    const model = window.toPayslipModel(d, 'weekly');
    model.official = false; // never yet saved — a draft/projection by construction
    model.ytd = await window.payslipYtdWeekly(profile.id, (d.payPeriodStart||'').slice(0,4) || (window.bizYear?window.bizYear():new Date().getFullYear()));
    window.renderPayslipPage(model, () => renderFinanceHRProfiles(deptContainer(), currentUser, currentRole));
  });

  document.getElementById('ps-save-btn').addEventListener('click', async () => {
    const d = collectPayslipData(profile, currentUser);
    if (!d) return;
    d.proofUrl = proofFile?.url || null;
    d.status = 'draft';
    d.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    d.createdBy = currentUser.uid;
    const ref = await db.collection('payslips').add(d);
    // Apply CA deduction to the worker's running balance — transaction-guarded
    // re-read (v12 WS22), instead of trusting the balance the modal opened with.
    if (d.deductions.other.cashAdvance > 0) {
      await window.CashAdvance.deductWorker(profile.id, d.deductions.other.cashAdvance, { reason:'weekly-payslip', payslipId: ref.id }).catch(()=>{});
    }
    // Note: the general-ledger entry is posted when the payslip is "Submitted" (see openPayslipHistory).
    closeModal();
    Notifs.success('Payslip saved as draft! Verify and file it from Payslip History.');
    const model = window.toPayslipModel({...d, id: ref.id}, 'weekly');
    model.ytd = await window.payslipYtdWeekly(profile.id, (d.payPeriodStart||'').slice(0,4) || (window.bizYear?window.bizYear():new Date().getFullYear()));
    setTimeout(() => window.renderPayslipPage(model, () => renderFinanceHRProfiles(deptContainer(), currentUser, currentRole)), 400);
  });
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

function collectPayslipData(profile, currentUser) {
  const daily    = parseFloat(document.getElementById('ps-daily').value)||0;
  const rph      = parseFloat(document.getElementById('ps-rph').value)||0;
  const hrs      = parseFloat(document.getElementById('ps-hrs').value)||0;
  const regTotal = parseFloat((rph * hrs).toFixed(2));  // hourly rate × hours worked
  const otRate   = parseFloat(document.getElementById('ps-ot-rate').value)||0;
  const otHrs    = parseFloat(document.getElementById('ps-ot-hrs').value)||0;
  const otTotal  = parseFloat((otRate * otHrs).toFixed(2));
  const meal     = parseFloat(document.getElementById('ps-meal').value)||0;
  const transport= parseFloat(document.getElementById('ps-transport').value)||0;
  const rent     = parseFloat(document.getElementById('ps-rent').value)||0;
  const allowTotal = meal + transport + rent;
  const grossPay = regTotal + otTotal + allowTotal;

  const sss   = parseFloat(document.getElementById('ps-sss').value)||0;
  const ph    = parseFloat(document.getElementById('ps-ph').value)||0;
  const pib   = parseFloat(document.getElementById('ps-pib').value)||0;
  const ca    = parseFloat(document.getElementById('ps-ca').value)||0;
  const loans = parseFloat(document.getElementById('ps-loans').value)||0;
  const tax   = parseFloat(document.getElementById('ps-tax').value)||0;
  const govTotal   = sss + ph + pib;
  const otherTotal = ca + loans + tax;
  const totalDeductions = govTotal + otherTotal;
  const totalPay = grossPay - totalDeductions;
  const paid     = parseFloat(document.getElementById('ps-paid').value)||0;
  const netPay   = totalPay - paid;

  const periodStart = document.getElementById('ps-start').value;
  const periodEnd   = document.getElementById('ps-end').value;
  if (!periodStart || !periodEnd) { Notifs.showToast('Set pay period dates','error'); return null; }

  const caBalanceBefore = profile.caBalance || 0;
  const caBalanceAfter  = Math.max(0, caBalanceBefore - ca);

  const timeLog = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=>({
    day: d,
    timeIn:  document.getElementById(`ps-tin-${i}`)?.value || '',
    timeOut: document.getElementById(`ps-tout-${i}`)?.value || '',
    hours: computeDayHours(document.getElementById(`ps-tin-${i}`)?.value, document.getElementById(`ps-tout-${i}`)?.value)
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
    payDate: document.getElementById('ps-date').value,
    company: document.getElementById('ps-company').value||'Barro Kitchens',
    preparedBy: document.getElementById('ps-preparer').value||currentUser?.displayName||'',
    regular: { dailyRate: daily, ratePerHr: rph, hrsWorked: hrs, total: regTotal },
    overtime: { ratePerHr: otRate, hours: otHrs, total: otTotal },
    allowances: { meal, transport, rent, total: allowTotal },
    grossPay,
    deductions: {
      govt: { sss, philhealth: ph, pagibig: pib, total: govTotal },
      other: { cashAdvance: ca, loans, taxes: tax, total: otherTotal }
    },
    employerShare: null, // v12 WS24 decision 3 — weekly ER manual-only for now; WS21/WS39 may populate later
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
    return {
      kind:'monthly', official:true,
      docNumber:`PS-${source.month || source.runMonth}-${source.uid || source.userId}`,
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
  return {
    kind:'weekly', official:true, docNumber:source.id||'',
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
window.buildPayslipHTML = function(model) {
  const f = n => (parseFloat(n)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const m = model, s = m.statutory, er = s.er;
  const erCell = k => er ? f(er[k]) : '—';
  const badge = m.official ? '' : `<div class="ps-badge-proj">PROJECTION — not yet disbursed</div>`;
  // Payslips are BIR/DOLE-facing — DTI trade name + real TIN (matches what this
  // template has always printed, and WS14's own resolution for this doc type).
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'PAYSLIP', entity: window.brandEntity ? window.brandEntity('bir') : null,
    accent: '#1E3A5F', docNumber: m.docNumber, dateLabel: m.periodLabel,
    signatures: m.signatures,
    footerNote: 'System-generated payslip · ' + escHtml(m.docNumber) + ' · ' + escHtml(m.periodLabel)
  }) : null;
  const perf = m.performance ? `
    <div class="ps-sec-h">Performance</div>
    <table class="ps-t">
      <tr><td>Task KPI (70%)</td><td class="num">${Math.round(m.performance.kpi*100)}%</td></tr>
      <tr><td>Attendance (30%)</td><td class="num">${Math.round(m.performance.att*100)}%</td></tr>
      <tr class="ps-sub"><td>Performance factor (policy: ${escHtml(m.performance.policy)})</td><td class="num">${m.performance.perfFactor.toFixed(2)}×</td></tr>
    </table>` : '';
  const timelog = (m.timeLog && m.timeLog.length) ? `
    <div class="ps-sec-h">Daily Time Log</div>
    <table class="ps-t"><thead><tr><th>Day</th><th>Time In</th><th>Time Out</th><th class="num">Hours</th></tr></thead>
    <tbody>${m.timeLog.map(r=>`<tr><td>${escHtml(r.day)}</td><td>${escHtml(r.timeIn||'—')}</td><td>${escHtml(r.timeOut||'—')}</td><td class="num">${(r.hours||0).toFixed(2)}</td></tr>`).join('')}</tbody></table>` : '';
  return `
  ${_lh ? `<style>${_lh.printCSS}</style>` : ''}
  ${_lh ? _lh.headerHTML : `<div class="lh-head"><div class="lh-name">${escHtml((window.BRAND&&window.BRAND.legal.dtiName)||'')}</div><div class="lh-doc"><div class="lh-title">PAYSLIP</div><div class="lh-no">${escHtml(m.docNumber)}</div><div class="lh-date">${escHtml(m.periodLabel)}</div></div></div>`}
  ${badge}
  <div class="ps-sec-h">Employee</div>
  <table class="ps-t">
    <tr><td class="lbl">Name</td><td>${escHtml(m.employee.name)}</td><td class="lbl">TIN</td><td>${escHtml(m.employee.tin)}</td></tr>
    <tr><td class="lbl">ID</td><td>${escHtml(m.employee.idNumber)}</td><td class="lbl">SSS</td><td>${escHtml(m.employee.sss)}</td></tr>
    <tr><td class="lbl">Job Title</td><td>${escHtml(m.employee.jobTitle)}</td><td class="lbl">PhilHealth</td><td>${escHtml(m.employee.philhealth)}</td></tr>
    <tr><td class="lbl">Department</td><td>${escHtml(m.employee.department)}</td><td class="lbl">Pag-IBIG</td><td>${escHtml(m.employee.pagibig)}</td></tr>
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
window.renderPayslipPage = function(model, backFn) {
  const headerRightHTML = `
    <button class="btn-primary btn-sm" onclick="window.print()">${emojiIcon('🖨',16)} Print / Save PDF</button>
    <button class="btn-secondary btn-sm" id="ps-jpeg-btn">${emojiIcon('📷',16)} Save as JPEG</button>
    ${model.proofUrl?`<a class="btn-secondary btn-sm" href="${safeHttpUrl(model.proofUrl)}" target="_blank">${emojiIcon('📎',16)} Transfer Proof</a>`:''}
  `;
  const bodyHTML = `<div class="payslip-print">${buildPayslipHTML(model)}</div>`;
  const panel = window.openPage(`${emojiIcon('🖨',16)} Payslip — ${escHtml(model.employee?.name||'')}`, bodyHTML, '', {
    headerRightHTML,
    onClose: () => { if (backFn) backFn(); }
  });
  panel.querySelector('#ps-jpeg-btn')?.addEventListener('click', () => window.downloadPayslipJPEG(model));
  if (window.lucide) lucide.createIcons({ nodes: [panel] });
  return panel;
};

// JPEG export — migrated from the old popup's inline script to the in-page container.
window.downloadPayslipJPEG = async function(model) {
  const btn = document.getElementById('ps-jpeg-btn');
  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
  if (!window.html2canvas) {
    await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  }
  const el = document.querySelector('.payslip-print');
  const canvas = await html2canvas(el, { scale:2, useCORS:true, backgroundColor:'#fff', logging:false });
  const link = document.createElement('a');
  link.download = `payslip-${(model.employee.name||'employee').replace(/\s+/g,'-')}-${(model.docNumber||'').replace(/[^a-zA-Z0-9-]/g,'')}.jpg`;
  link.href = canvas.toDataURL('image/jpeg', 0.95);
  link.click();
  if (btn) { btn.textContent = '📷 Save as JPEG'; btn.disabled = false; }
};
