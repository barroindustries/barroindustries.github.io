/* ═══════════════════════════════════════════════════════════════════════
   BARRO INDUSTRIES — EMPLOYEE PROFILE
   js/screens/employee-profile.js
   ═══════════════════════════════════════════════════════════════════════

   Owner request, verbatim (2026-08-09):
   > "add this to the system, employee profiles on hr, where we can input their
   >  official employment date, sss number etc, their status like training,
   >  employed, or what, what their job is etc, all which can be edited by hr.
   >  here is where we will also see rates,ca,raise,payroll history etc"
   > "make it uniform for office and operations team"

   ONE profile screen per person, the same for both teams.

   ── IT IS A VIEW, NOT A NEW COLLECTION ────────────────────────────────
   Every field the owner listed already existed, scattered across three
   collections under two different vocabularies. Nothing here mints a parallel
   store; this file COMPOSES:

     users/{uid}              identity — displayName, title, department(s),
                              employeeId, startDate, employmentStatus, phone
     payroll/{uid}            Office Team money — salary, allowance, deductions,
                              payClass, tinNum/ssNum/phNum/pagibigNum
     worker_profiles/{id}     Operations Team — name, jobTitle, department,
                              idNumber, dailyRate/hourlyRate, caBalance,
                              employmentType/workType, the same four gov numbers
     cash_advances            Office Team CA ledger + its embedded payments[]
     salary_raises            applied raises (immutable audit log)
     pending_raises           scheduled / awaiting-approval raises
     salary_history           Office Team monthly pay history
     payslips                 Operations Team weekly pay history

   ── PAY IS READ-ONLY HERE ─────────────────────────────────────────────
   The profile never writes salary, dailyRate or caBalance. "Give Raise" calls
   the existing approval-routed openSalaryRaiseModal / window.RaiseFlow; cash
   advances stay with window.CashAdvance. There are already too many ways to
   change someone's pay (see the WARNING at the foot of this file) — this adds
   none.

   ── TWO TIERS, AND DENIALS ARE NAMED ──────────────────────────────────
   Identity (users) is readable/editable by the isAdmin tier — president,
   manager and the Corporate Secretary. Money (payroll, worker_profiles,
   salary_history, payslips, salary_raises) is isMoneyAdmin — president,
   manager, finance. The Corporate Secretary is deliberately outside it.
   Every money read in this file therefore records WHY it came back empty, and
   a denied section is LABELLED rather than rendered as ₱0 — a fabricated zero
   on a pay screen is worse than a blank.

   ── LOADS AFTER js/screens/hr.js ──────────────────────────────────────
   Calls openSalaryRaiseModal / openRaiseHistory / openHRProfileForm (hr.js)
   and openPage / escHtml / fmt (app.js, config.js, departments.js) as bare
   globals at CLICK time, so only the <script defer> order in index.html
   matters, not module resolution.
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Small local helpers ────────────────────────────────────────────────
function _epFmt(n) { return (window.fmtN2 ? window.fmtN2(n) : Number(n || 0).toFixed(2)); }
function _epEsc(s) { return window.escHtml ? window.escHtml(s == null ? '' : s) : String(s == null ? '' : s); }
function _epIcon(g, sz) { return window.emojiIcon ? window.emojiIcon(g, sz || 16) : ''; }

// Was a read refused, or is there genuinely nothing on file? Every reader in
// this app swallows a denial into an empty array, which on a pay screen reads
// as "₱0 / no records" — indistinguishable from a brand-new hire. This wraps a
// read so the caller can tell the two apart and say so on screen.
async function _epRead(promise, fallback) {
  try { return { ok: true, value: await promise }; }
  catch (e) {
    return {
      ok: false,
      denied: e && (e.code === 'permission-denied' || e.code === 'permission_denied'),
      error: e,
      value: fallback
    };
  }
}

// A section the current user may not read. Never renders a number.
function _epWithheldCard(title, why) {
  return `<div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>${_epEsc(title)}</h3><span class="badge badge-gray">${_epIcon('🔒', 14)} Not shown</span></div>
      <div class="card-body" style="font-size:12px;color:var(--text-muted)">${_epEsc(why)}</div>
    </div>`;
}

function _epRow(label, value, opts) {
  opts = opts || {};
  const v = (value === null || value === undefined || value === '') ? '—' : value;
  return `<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border);font-size:13px;align-items:flex-start">
      <span style="color:var(--text-muted);flex:0 0 44%;min-width:0">${_epEsc(label)}</span>
      <span style="font-weight:600;text-align:right;flex:1;min-width:0;word-break:break-word">${opts.raw ? v : _epEsc(v)}</span>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════════════
   THE NORMALISING READ-ADAPTER
   The two teams use DIFFERENT field names for four of five identity fields:
     name      users.displayName   vs worker_profiles.name
     job title users.title         vs worker_profiles.jobTitle
     dept      users.department(s) vs worker_profiles.department (own vocabulary)
     ID        users.employeeId    vs worker_profiles.idNumber
   Only the four government numbers already share one vocabulary
   (tinNum/ssNum/phNum/pagibigNum) — which is what makes one profile cheap.

   This function normalises for DISPLAY ONLY. It never renames a stored field:
   js/screens/worker.js, js/bir.js, toPayslipModel and the payslip /
   salary_history mirrors all read the current names, and renaming either side
   would break them.
   ═══════════════════════════════════════════════════════════════════════ */
function _epCompose(user, pay, wp, meta) {
  const m = meta || {};
  const u = user || {};
  const p = pay || {};
  const w = wp || {};
  const depts = Array.isArray(u.departments) && u.departments.length
    ? u.departments
    : (u.department ? [u.department] : (w.department ? [w.department] : []));
  // payClass drives which side owns the money fields. An ABSENT payClass reads
  // as 'regular' — the same default the pay run itself applies
  // (window.monthlyRunSkipReason), so this screen can never disagree with it.
  const isOps = p.payClass === 'production' || (!user && !!wp);
  // ...but 'regular' is a DEFAULT, not a reading. payClass lives in
  // `payroll/{uid}` and the Operations link lives in `worker_profiles`; a role
  // that may read NEITHER (the Corporate Secretary) gets `isOps === false` for
  // everyone, and the badge would tell the one oversight role that a weekly
  // Operations worker is monthly Office staff. Say "withheld" instead.
  const payClassKnown = isOps || !!p.payClass || (!m.payDenied && !m.wpDenied);
  return {
    payClassKnown,
    name:       u.displayName || w.name || '(unnamed)',
    title:      u.title || w.jobTitle || '',
    depts,
    idNumber:   u.employeeId || w.idNumber || '',
    email:      u.email || '',
    phone:      u.phone || w.phone || '',
    address:    w.address || '',
    photo:      u.photoUrl || u.photoURL || w.photoUrl || '',
    role:       u.role || '',
    // Official employment date. users.startDate is the Office Team field and is
    // set at CREATE by five call sites but had NO editor anywhere — a wrong
    // hire date was unfixable in the UI. worker_profiles has no startDate at
    // all; its `issuedOn` is the ID-CARD issue date (labelled "Issued On" on
    // the HR form) that js/screens/worker.js reads as a hire date to block
    // pre-hire punches. We add a real `startDate` to worker_profiles rather
    // than repurposing issuedOn, and fall back to issuedOn for existing
    // workers so nothing regresses.
    startDate:  u.startDate || w.startDate || w.issuedOn || '',
    startDateIsFallback: !u.startDate && !w.startDate && !!w.issuedOn,
    employmentStatus: u.employmentStatus || w.employmentStatus || '',
    employmentType:   w.employmentType || '',
    workType:         w.workType || '',
    removed:    u.removed === true,
    isOps,
    payClass:   p.payClass || (isOps ? 'production' : 'regular'),
    // Government numbers — ONE vocabulary across both teams. Read the side that
    // owns this person, then fall back, so a value entered on either editor is
    // visible here. (See the WARNING at the foot of this file: a person in BOTH
    // populations has two independent copies that can disagree.)
    tinNum:     (isOps ? (w.tinNum     || p.tinNum)     : (p.tinNum     || w.tinNum))     || '',
    ssNum:      (isOps ? (w.ssNum      || p.ssNum)      : (p.ssNum      || w.ssNum))      || '',
    phNum:      (isOps ? (w.phNum      || p.phNum)      : (p.phNum      || w.phNum))      || '',
    pagibigNum: (isOps ? (w.pagibigNum || p.pagibigNum) : (p.pagibigNum || w.pagibigNum)) || ''
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   window.openEmployeeProfile({ uid, workerId, name })
   At least one of uid / workerId is required.
     uid      — a Firebase Auth uid (Office Team, and Operations staff who have
                a login). Resolves the worker profile via linkedUid.
     workerId — a worker_profiles docId, for the many Operations staff who have
                no login at all. Resolves the user doc via that profile's
                linkedUid, if it has one.
   NEVER branches on the SHAPE of an id. New unified staff are created with
   worker_profiles.doc(uid) so profileId === uid, but existing workers keep
   their auto-ids — every join resolves through linkedUid, never the id shape.
   ═══════════════════════════════════════════════════════════════════════ */
window.openEmployeeProfile = function (opts) {
  opts = opts || {};
  const uid0 = opts.uid || '';
  const wid0 = opts.workerId || '';
  if (!uid0 && !wid0) { window.Notifs && Notifs.showToast('No person selected.', 'error'); return; }

  // WINDOW FIRST, DATA SECOND — the panel is pushed synchronously in the tap
  // handler so the press has something to animate; the body fills afterwards.
  const panel = window.openPage(
    `${_epIcon('🪪', 16)} Employee Profile${opts.name ? ' — ' + _epEsc(opts.name) : ''}`,
    window.skeletonHtml ? window.skeletonHtml('rows') : '<p>Loading…</p>',
    `<button class="btn-secondary" onclick="closeModal()">Close</button>`
  );
  const body = panel.querySelector('.page-panel-body');
  _epLoad(panel, body, { uid: uid0, workerId: wid0 });
  return panel;
};

async function _epLoad(panel, body, ids) {
  let uid = ids.uid;
  let workerId = ids.workerId;

  // ── Resolve the two halves ───────────────────────────────────────────
  let userRes = { ok: true, value: null }, wpRes = { ok: true, value: null }, payRes = { ok: true, value: null };

  if (!uid && workerId) {
    wpRes = await _epRead(db.collection('worker_profiles').doc(workerId).get(), null);
    const wpDoc = wpRes.value;
    if (wpDoc && wpDoc.exists) { const d = wpDoc.data(); if (d.linkedUid) uid = d.linkedUid; }
  }

  const reads = [];
  if (uid) {
    reads.push(_epRead(db.collection('users').doc(uid).get(), null).then(r => { userRes = r; }));
    reads.push(_epRead(db.collection('payroll').doc(uid).get(), null).then(r => { payRes = r; }));
    if (!workerId) {
      // THE canonical Office↔Operations join. Never assume the docId shape.
      reads.push(_epRead(
        db.collection('worker_profiles').where('linkedUid', '==', uid).limit(1).get(), { docs: [] }
      ).then(r => {
        wpRes = r;
        const d = r.value && r.value.docs && r.value.docs[0];
        if (d) workerId = d.id;
      }));
    }
  }
  await Promise.all(reads);

  // CLOSED MID-FLIGHT — Back can be pressed before the reads land. openPage's
  // teardown detaches the panel; bail rather than writing to an orphan node.
  if (!panel.isConnected) return;

  const userDoc = userRes.value;
  const user = userDoc && userDoc.exists ? { id: userDoc.id, ...userDoc.data() } : null;
  const payDoc = payRes.value;
  const pay = payDoc && payDoc.exists ? payDoc.data() : null;
  let wp = null;
  if (wpRes.value) {
    if (wpRes.value.docs) { const d = wpRes.value.docs[0]; if (d) wp = { id: d.id, ...d.data() }; }
    else if (wpRes.value.exists) wp = { id: wpRes.value.id, ...wpRes.value.data() };
  }
  if (wp && !workerId) workerId = wp.id;

  if (!user && !wp) {
    body.innerHTML = `<div class="empty-state" style="padding:30px">
        <div class="empty-icon">${_epIcon('🪪', 44)}</div>
        <h4>Profile not found</h4>
        <p style="font-size:12px;color:var(--text-muted)">${
          (userRes.denied || wpRes.denied)
            ? 'This record exists but is outside your access.'
            : 'No user or worker record matched.'}</p>
      </div>`;
    return;
  }

  const P = _epCompose(user, pay, wp, { payDenied: !payRes.ok, wpDenied: !wpRes.ok });
  // Money tier — the client mirror of firestore.rules isMoneyAdmin().
  const canMoney = (typeof window.isMoneyPriv === 'function') ? window.isMoneyPriv() : true;
  // HR identity edit — the client mirror of firestore.rules isAdmin(). Keeps
  // the Corporate Secretary in (owner ruling: "HR stays open").
  const canHrEdit = (typeof window.isAdminPriv === 'function') ? window.isAdminPriv() : false;
  // department / employeeId are frozen by userPrivilegedFieldsUnchanged() for
  // the non-senior isAdmin branch, so only president/manager may change them.
  const canSenior = ['president', 'owner', 'manager'].includes(window.currentRole || '');
  // The money half was refused (not merely absent) — say so instead of ₱0.
  const moneyDenied = !canMoney || payRes.denied || wpRes.denied;

  const stMeta = window.employmentStatusMeta
    ? window.employmentStatusMeta(P.employmentStatus)
    : { label: P.employmentStatus || 'Not set', badge: 'badge-gray' };

  const TABS = [
    { key: 'employment', label: 'Employment', icon: _epIcon('🪪', 14) },
    { key: 'pay',        label: 'Pay & Raises', icon: _epIcon('💸', 14) },
    { key: 'ca',         label: 'Cash Advance', icon: _epIcon('🏦', 14) },
    { key: 'history',    label: 'Payroll History', icon: _epIcon('📄', 14) }
  ];
  let active = 'employment';

  const heroHtml = () => `
    <div class="card" style="margin-bottom:14px">
      <div class="card-body" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <div style="width:56px;height:56px;border-radius:50%;overflow:hidden;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:22px;flex:0 0 auto">
          ${P.photo
            ? `<img src="${_epEsc(P.photo)}" alt="" style="width:100%;height:100%;object-fit:cover">`
            : _epIcon('👤', 26)}
        </div>
        <div style="flex:1;min-width:150px">
          <div style="font-size:16px;font-weight:800;line-height:1.25">${_epEsc(P.name)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
            ${_epEsc(P.title || 'No job title on file')}${P.depts.length ? ' · ' + _epEsc(P.depts.join(', ')) : ''}
          </div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            <span class="badge ${_epEsc(stMeta.badge)}">${_epEsc(stMeta.label)}</span>
            ${P.payClassKnown
              ? `<span class="badge ${P.isOps ? 'badge-orange' : 'badge-blue'}">${P.isOps ? 'Operations Team · weekly' : 'Office Team · monthly'}</span>`
              : `<span class="badge badge-gray" title="The pay record and the Operations worker register are both closed to your role, so which team this person is paid on cannot be shown.">Team withheld</span>`}
            ${P.removed ? `<span class="badge badge-red">Offboarded</span>` : ''}
            ${P.idNumber ? `<span class="badge badge-gray">${_epEsc(P.idNumber)}</span>` : ''}
          </div>
        </div>
      </div>
    </div>`;

  const render = () => {
    if (!panel.isConnected) return;
    body.innerHTML = heroHtml()
      + (window.chipTabs ? window.chipTabs(TABS, active) : '')
      + `<div id="ep-tab-body" style="margin-top:12px">${window.skeletonHtml ? window.skeletonHtml('rows') : ''}</div>`;
    if (window.bindChipTabs) {
      window.bindChipTabs(body, (key) => { active = key; render(); });
    }
    if (window.lucide) lucide.createIcons({ nodes: [body] });
    const tb = body.querySelector('#ep-tab-body');
    if (!tb) return;
    const ctx = { panel, uid, workerId, user, pay, wp, P, canMoney, canHrEdit, canSenior, moneyDenied, reload: render };
    if (active === 'employment')   _epTabEmployment(tb, ctx);
    else if (active === 'pay')     _epTabPay(tb, ctx);
    else if (active === 'ca')      _epTabCashAdvance(tb, ctx);
    else                           _epTabHistory(tb, ctx);
  };
  render();
}

/* ── TAB 1 — EMPLOYMENT (the only editable tab) ───────────────────────── */
function _epTabEmployment(tb, ctx) {
  const { P, canHrEdit, canSenior, canMoney, moneyDenied } = ctx;
  const statuses = window.EMPLOYMENT_STATUSES || {};
  const stMeta = window.employmentStatusMeta ? window.employmentStatusMeta(P.employmentStatus) : { label: '—' };

  tb.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>Employment</h3>
        ${canHrEdit ? `<button class="btn-primary btn-sm" id="ep-edit-btn">${_epIcon('✎', 14)} Edit</button>` : ''}
      </div>
      <div class="card-body" style="padding:4px 16px 12px">
        ${_epRow('Official employment date', P.startDate
            ? P.startDate + (P.startDateIsFallback ? '  (from ID “Issued On” — please confirm)' : '')
            : '')}
        ${_epRow('Employment status', stMeta.label)}
        ${_epRow('Job title', P.title)}
        ${_epRow('Department', P.depts.join(', '))}
        ${_epRow('Employee / Worker ID', P.idNumber)}
        ${_epRow('Pay class', P.payClassKnown
          ? (P.isOps ? 'Operations Team — paid weekly' : 'Office Team — paid monthly')
          : 'Withheld — your role may not read the pay record or the Operations worker register, so the team cannot be determined')}
        ${P.employmentType ? _epRow('Employment type', P.employmentType) : ''}
        ${P.workType ? _epRow('Work arrangement', P.workType) : ''}
        ${_epRow('Email', P.email)}
        ${_epRow('Phone', P.phone)}
        ${P.address ? _epRow('Address', P.address) : ''}
      </div>
    </div>

    ${canMoney ? `
    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>Government numbers</h3></div>
      <div class="card-body" style="padding:4px 16px 12px">
        ${_epRow('SSS number', P.ssNum)}
        ${_epRow('PhilHealth number', P.phNum)}
        ${_epRow('Pag-IBIG MID', P.pagibigNum)}
        ${_epRow('TIN', P.tinNum)}
        <p style="font-size:11px;color:var(--text-muted);margin-top:10px">Government numbers live with the pay record. Edit them from ${P.isOps ? 'HR → Operations Team → this worker' : 'Payroll → Edit Payroll'}, which is where the payslip and BIR alphalist read them from.</p>
      </div>
    </div>` : _epWithheldCard('Government numbers',
        'SSS, PhilHealth, Pag-IBIG and TIN are stored with the pay record, which is limited to the President, a Manager and the Accountant. They are withheld here rather than shown blank.')}

    
    <p style="font-size:11px;color:var(--text-muted)">Employment status is a record of the hiring stage. It does <strong>not</strong> take anyone out of a pay run — offboarding is still People &rarr; Remove, and “not on payroll” is set on the payroll record.</p>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [tb] });

  const editBtn = tb.querySelector('#ep-edit-btn');
  if (editBtn) editBtn.addEventListener('click', () => _epOpenEditor(ctx, statuses));
}

/* ── The HR editor ─────────────────────────────────────────────────────
   Writes ONLY HR-owned identity fields, and only to the doc that owns them:
     users/{uid}         — startDate, employmentStatus, title, phone (+ dept and
                           employeeId for president/manager only)
     worker_profiles/{id}— the same three for Operations staff with NO login,
                           who have no users doc to carry them
   It never touches salary, dailyRate, caBalance or the government numbers.
   ──────────────────────────────────────────────────────────────────────── */
function _epOpenEditor(ctx, statuses) {
  const { P, uid, workerId, user, wp, canSenior, canMoney } = ctx;
  const DEPTS = Object.keys(window.DEPARTMENTS || {});
  const stKeys = Object.keys(statuses);
  // Where identity lives for THIS person. A worker with no login has no users
  // doc, so their identity home is the worker profile — which is a MONEY-tier
  // write, so the Corporate Secretary cannot edit those records at all.
  const identityTarget = user ? 'users' : 'worker_profiles';
  const blockedByTier = identityTarget === 'worker_profiles' && !canMoney;

  const panel = window.openPage(`${_epIcon('✎', 16)} Edit Employment — ${_epEsc(P.name)}`, `
    ${blockedByTier ? `<div class="alert-banner" style="cursor:default;margin-bottom:12px"><span>${_epIcon('🔒', 16)} This person has no login account, so their details live on the worker record — which only the President, a Manager or the Accountant may change.</span></div>` : ''}
    <div class="form-group">
      <label for="ep-start">Official employment date</label>
      <input id="ep-start" type="date" value="${_epEsc(P.startDate || '')}"/>
      ${P.startDateIsFallback ? `<p style="font-size:11px;color:var(--text-muted);margin-top:4px">Currently showing the ID card’s “Issued On” date because no employment date is on file. Saving here records a real employment date.</p>` : ''}
    </div>
    <div class="form-group">
      <label for="ep-status">Employment status</label>
      <select id="ep-status">
        <option value="">— not set —</option>
        ${stKeys.map(k => `<option value="${_epEsc(k)}"${P.employmentStatus === k ? ' selected' : ''}>${_epEsc(statuses[k].label)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label for="ep-title">Job title</label>
      <input id="ep-title" value="${_epEsc(P.title)}" placeholder="e.g. Welder, Sales Officer"/>
    </div>
    <div class="form-group">
      <label for="ep-phone">Phone</label>
      <input id="ep-phone" value="${_epEsc(P.phone)}" placeholder="09xx xxx xxxx"/>
    </div>
    ${identityTarget === 'users' ? `
    <div class="form-group">
      <label for="ep-dept">Department</label>
      <select id="ep-dept" ${canSenior ? '' : 'disabled'}>
        <option value="">— none —</option>
        ${DEPTS.map(d => `<option value="${_epEsc(d)}"${P.depts[0] === d ? ' selected' : ''}>${_epEsc(d)}</option>`).join('')}
      </select>
      ${canSenior ? '' : `<p style="font-size:11px;color:var(--text-muted);margin-top:4px">Department is set by the President or a Manager.</p>`}
    </div>` : ''}
    <p style="font-size:11px;color:var(--text-muted);margin-top:6px">Pay rate, cash-advance balance and government numbers are <strong>not</strong> edited here — see the Pay tab.</p>
  `, `<button class="btn-primary" id="ep-save-btn"${blockedByTier ? ' disabled' : ''}>Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  const saveBtn = panel.querySelector('#ep-save-btn');
  if (!saveBtn) return;
  saveBtn.addEventListener('click', async () => {
    // SCOPED to this panel — a stale panel's inputs must never be read. This is
    // this app's largest defect class: openPage removes a dismissed panel on a
    // 300ms delay, so a document-wide getElementById can bind to the dying one.
    const startDate = (panel.querySelector('#ep-start')?.value || '').trim();
    const status    = (panel.querySelector('#ep-status')?.value || '').trim();
    const title     = (panel.querySelector('#ep-title')?.value || '').trim();
    const phone     = (panel.querySelector('#ep-phone')?.value || '').trim();
    const deptSel   = panel.querySelector('#ep-dept');
    const dept      = deptSel && !deptSel.disabled ? deptSel.value : null;

    if (status && !Object.prototype.hasOwnProperty.call(statuses, status)) {
      Notifs.showToast('Unknown employment status.', 'error'); return;
    }
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      Notifs.showToast('Employment date must be a real date.', 'error'); return;
    }

    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      if (identityTarget === 'users') {
        const patch = {
          startDate,
          employmentStatus: status,
          title,
          phone,
          employmentUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          employmentUpdatedBy: window.currentUser ? currentUser.uid : ''
        };
        // department is frozen for the non-senior isAdmin branch in the rules —
        // only include it when the actor may actually write it, so a secretary's
        // save is not rejected wholesale for a field they never changed.
        //
        // AND ONLY WHEN IT ACTUALLY CHANGED, PRESERVING THE REST. This select can
        // hold ONE department, but a person can hold several — js/app.js declares
        // `currentDepts` an array "supports dual department", and both existing
        // editors carry a second select for exactly that reason. Writing
        // `departments: [dept]` unconditionally meant that opening a profile to
        // correct a HIRE DATE and pressing Save silently deleted every secondary
        // membership: nav, page access and canEditDept() all derive from that
        // array, so the person quietly lost a department at next login — and if
        // the survivor happened to be 'Brilliant Steel' alone, the payroll roster
        // reclassifies them as an external partner and DROPS THEM FROM THE
        // MONTHLY RUN. The toast said "Employment details saved."
        // Unchanged -> omit entirely. Changed -> new primary first, every other
        // existing membership preserved behind it.
        const _origPrimary = P.depts[0] || '';
        if (dept !== null && dept !== _origPrimary) {
          const rest = (P.depts || []).filter(d => d && d !== dept);
          patch.department  = dept;
          patch.departments = dept ? [dept].concat(rest) : rest;
        }
        await db.collection('users').doc(uid).set(patch, { merge: true });
      } else {
        await db.collection('worker_profiles').doc(workerId).set({
          startDate,
          employmentStatus: status,
          jobTitle: title,
          phone,
          employmentUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          employmentUpdatedBy: window.currentUser ? currentUser.uid : ''
        }, { merge: true });
      }
      if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('users'); dbCacheInvalidate('worker_profiles'); }
      // Toasts render via textContent — plain emoji only, never emojiIcon() HTML.
      Notifs.success('Employment details saved.');
      if (typeof closeModal === 'function') closeModal();
      // Re-open cleanly against the freshly written docs.
      window.openEmployeeProfile({ uid, workerId, name: P.name });
      // …and put the ROSTER behind this back in step. Without it the list keeps
      // showing the value it loaded before the edit, and closing back to it
      // reads exactly like the save having been thrown away.
      _epRefreshRosterIfOpen();
    } catch (e) {
      saveBtn.disabled = false; saveBtn.textContent = 'Save';
      Notifs.showToast(e && e.code === 'permission-denied'
        ? 'Saving was refused — you do not have permission to change this record.'
        : 'Could not save: ' + ((e && e.message) || e), 'error');
    }
  });
}

/* ── TAB 2 — PAY & RAISES (read-only; raises route through approval) ──── */
async function _epTabPay(tb, ctx) {
  const { P, uid, workerId, pay, wp, canMoney, panel } = ctx;
  if (!canMoney) {
    tb.innerHTML = _epWithheldCard('Pay & raises',
      'Pay rates, allowances and applied raises are limited to the President, a Manager and the Accountant. They are withheld here rather than shown as ₱0. Pending raise REQUESTS are still visible in Approvals.');
    return;
  }
  tb.innerHTML = window.skeletonHtml ? window.skeletonHtml('rows') : '';

  // Applied raises and scheduled raises are two halves of one lifecycle and
  // live in two collections. Query BOTH id spaces: salary_raises.subjectId is
  // an auth uid for subjectType 'payroll' and a worker_profiles docId for
  // 'worker_profile' — a uid-only query shows an Operations worker an empty
  // raise history while they have one.
  const subjectIds = [uid, workerId].filter(Boolean);
  // Equality-only + client-side sort: an orderBy here would need a composite
  // index that does not exist, and a missing index throws FAILED_PRECONDITION,
  // which this app's ambient catches render as "no history".
  const q = (col) => subjectIds.length
    ? db.collection(col).where('subjectId', 'in', subjectIds).limit(100).get()
    : Promise.resolve({ docs: [] });
  const [appliedR, pendingR] = await Promise.all([
    _epRead(q('salary_raises'), { docs: [] }),
    _epRead(q('pending_raises'), { docs: [] })
  ]);
  if (!panel.isConnected) return;

  const byNewest = (a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
  const applied = (appliedR.value.docs || []).map(d => ({ id: d.id, ...d.data() })).sort(byNewest);
  const pendingAll = (pendingR.value.docs || []).map(d => ({ id: d.id, ...d.data() })).sort(byNewest);
  const pending = pendingAll.filter(r => r.status === 'pending_approval' || r.status === 'scheduled');

  const rateRows = P.isOps
    ? `${_epRow('Daily rate', wp ? '₱' + _epFmt(wp.dailyRate) : '')}
       ${_epRow('Hourly rate', wp ? '₱' + _epFmt(wp.hourlyRate) : '')}
       ${_epRow('Food allowance / day', wp ? '₱' + _epFmt(wp.foodAllowance) : '')}
       ${_epRow('Meal allowance', wp ? '₱' + _epFmt(wp.allowances?.meal) : '')}
       ${_epRow('Transport allowance', wp ? '₱' + _epFmt(wp.allowances?.transport) : '')}`
    : `${_epRow('Base salary (monthly)', pay ? '₱' + _epFmt(pay.salary) : '')}
       ${_epRow('Allowance', pay ? '₱' + _epFmt(pay.allowance) : '')}
       ${_epRow('Other deductions', pay ? '₱' + _epFmt(pay.deductions) : '')}`;

  const raiseTable = (list, empty) => !list.length
    ? `<div class="empty-state" style="padding:22px"><p style="font-size:12px">${_epEsc(empty)}</p></div>`
    : `<div class="table-wrap"><table class="data-table table-cards no-toggle">
        <thead><tr><th>Effective</th><th>Old → New</th><th>Change</th><th>Reason</th><th>Status</th></tr></thead>
        <tbody>${list.map(r => {
          const up = (r.changeAmount || 0) >= 0;
          return `<tr>
            <td data-label="Effective" style="white-space:nowrap;font-size:12px">${_epEsc(r.effectiveDate || '—')}</td>
            <td data-label="Old → New" style="font-size:12px">₱${_epFmt(r.oldAmount)} → <strong>₱${_epFmt(r.newAmount)}</strong></td>
            <td data-label="Change" style="font-weight:700;color:${up ? 'var(--success)' : 'var(--danger)'}">${up ? '+' : ''}₱${_epFmt(r.changeAmount)}</td>
            <td data-label="Reason" style="font-size:12px">${_epEsc(r.reason || '—')}</td>
            <td data-label="Status"><span class="badge badge-gray">${_epEsc(r.status || 'applied')}</span></td>
          </tr>`;
        }).join('')}</tbody></table></div>`;

  tb.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>Current rate</h3>
        <button class="btn-primary btn-sm" id="ep-raise-btn">${_epIcon('💸', 14)} Give Raise</button>
      </div>
      <div class="card-body" style="padding:4px 16px 12px">
        ${rateRows}
        <p style="font-size:11px;color:var(--text-muted);margin-top:10px">Rates are read-only here. Every change goes through the approval-routed Raise flow, so there is one audit trail and one approver.</p>
      </div>
    </div>

    ${pending.length ? `<div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>Scheduled / awaiting approval</h3></div>
      <div class="card-body" style="padding:0">${raiseTable(pending, '')}</div>
    </div>` : ''}

    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>Raise history</h3>
        <button class="btn-secondary btn-sm" id="ep-raise-hist-btn">Full history</button>
      </div>
      <div class="card-body" style="padding:0">
        ${appliedR.ok
          ? raiseTable(applied, 'No raises recorded for this person yet.')
          : `<div class="empty-state" style="padding:22px"><p style="font-size:12px">${appliedR.denied ? 'Raise history is outside your access.' : 'Raise history could not be loaded.'}</p></div>`}
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [tb] });

  tb.querySelector('#ep-raise-hist-btn')?.addEventListener('click', () => {
    if (typeof openRaiseHistory === 'function') openRaiseHistory({ subjectId: uid || workerId, subjectIds, subjectName: P.name });
  });
  tb.querySelector('#ep-raise-btn')?.addEventListener('click', () => {
    if (typeof openSalaryRaiseModal !== 'function') { Notifs.showToast('Raise flow unavailable.', 'error'); return; }
    // The two existing raise descriptors, unchanged — this screen must never
    // become a second way to write pay.
    const desc = P.isOps && workerId
      ? { subjectType: 'worker_profile', subjectId: workerId, subjectName: P.name,
          fieldLabel: 'Daily Rate', targetField: 'dailyRate', current: wp ? wp.dailyRate : 0 }
      : { subjectType: 'payroll', subjectId: uid, subjectName: P.name,
          fieldLabel: 'Base Salary', targetField: 'salary', current: pay ? pay.salary : 0 };
    openSalaryRaiseModal(desc, window.currentUser, () => window.openEmployeeProfile({ uid, workerId, name: P.name }));
  });
}

/* ── TAB 3 — CASH ADVANCE (read-only) ─────────────────────────────────
   The two teams have two entirely separate ledgers and this screen says so
   rather than pretending they are one:
     Office Team     — the cash_advances collection, with payments[] embedded
                       on each doc as the authoritative repayment record
     Operations Team — worker_profiles.caBalance, a single scalar with NO
                       ledger of its own. The only per-transaction trail is the
                       payslip series (caBalanceBefore/After), so that is what
                       is shown, labelled for what it is.
   caBalance is deliberately NOT editable here: on the HR worker form it is a
   raw number input whose save overwrites the ledger with no audit row.
   ───────────────────────────────────────────────────────────────────── */
async function _epTabCashAdvance(tb, ctx) {
  const { P, uid, workerId, wp, canMoney, panel } = ctx;
  tb.innerHTML = window.skeletonHtml ? window.skeletonHtml('rows') : '';

  const caRes = uid
    ? await _epRead(db.collection('cash_advances').where('userId', '==', uid).get(), { docs: [] })
    : { ok: true, value: { docs: [] } };
  let slipRes = { ok: true, value: { docs: [] } };
  if (P.isOps && workerId && canMoney) {
    slipRes = await _epRead(
      db.collection('payslips').where('workerId', '==', workerId).orderBy('createdAt', 'desc').limit(12).get(),
      { docs: [] });
  }
  if (!panel.isConnected) return;

  const cas = (caRes.value.docs || []).map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const outstanding = cas.filter(a => a.status === 'approved' && (a.balance || 0) > 0)
    .reduce((s, a) => s + (a.balance || 0), 0);

  const payments = [];
  cas.forEach(a => (Array.isArray(a.payments) ? a.payments : []).forEach(p => payments.push({ ...p, caId: a.id })));
  payments.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const slips = (slipRes.value.docs || []).map(d => d.data())
    .filter(s => (s.deductions?.other?.cashAdvance || 0) > 0);

  tb.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>Outstanding balance</h3></div>
      <div class="card-body" style="padding:4px 16px 12px">
        ${caRes.ok
          ? _epRow('Office Team ledger (cash advances)', '₱' + _epFmt(outstanding))
          : _epRow('Office Team ledger (cash advances)', caRes.denied ? 'Not shown — outside your access' : 'Could not be loaded')}
        ${P.isOps
          ? (canMoney
              ? _epRow('Operations Team balance (on the worker record)', wp ? '₱' + _epFmt(wp.caBalance) : '—')
              : _epRow('Operations Team balance (on the worker record)', 'Not shown — outside your access'))
          : ''}
        <p style="font-size:11px;color:var(--text-muted);margin-top:10px">Read-only. Advances are created, approved and repaid through Cash Advances; the balance is maintained by the pay run.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>Advances</h3></div>
      <div class="card-body" style="padding:0">
        ${!caRes.ok
          ? `<div class="empty-state" style="padding:22px"><p style="font-size:12px">${caRes.denied ? 'Cash advances are outside your access.' : 'Could not load cash advances.'}</p></div>`
          : !cas.length
            ? `<div class="empty-state" style="padding:22px"><p style="font-size:12px">No cash advances on record.</p></div>`
            : `<div class="table-wrap"><table class="data-table table-cards no-toggle">
                <thead><tr><th>Date</th><th>Amount</th><th>Total payable</th><th>Balance</th><th>Status</th></tr></thead>
                <tbody>${cas.map(a => `<tr>
                  <td data-label="Date" style="font-size:12px;white-space:nowrap">${_epEsc(a.date || '—')}</td>
                  <td data-label="Amount">₱${_epFmt(a.amount)}</td>
                  <td data-label="Total payable">₱${_epFmt(a.totalPayable)}</td>
                  <td data-label="Balance" style="font-weight:700">₱${_epFmt(a.balance)}</td>
                  <td data-label="Status"><span class="badge badge-gray">${_epEsc(a.status || '—')}</span></td>
                </tr>`).join('')}</tbody></table></div>`}
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>Repayments</h3></div>
      <div class="card-body" style="padding:0">
        ${payments.length
          ? `<div class="table-wrap"><table class="data-table table-cards no-toggle">
              <thead><tr><th>Date</th><th>Amount</th><th>Source</th></tr></thead>
              <tbody>${payments.map(p => `<tr>
                <td data-label="Date" style="font-size:12px;white-space:nowrap">${_epEsc(p.date || '—')}</td>
                <td data-label="Amount">₱${_epFmt(p.amount)}</td>
                <td data-label="Source" style="font-size:12px">${_epEsc(p.source || 'manual')}</td>
              </tr>`).join('')}</tbody></table></div>`
          : P.isOps
            ? (slips.length
                ? `<p style="font-size:11px;color:var(--text-muted);padding:10px 16px 0">Operations Team cash advances have no ledger of their own — this is reconstructed from the payslips that deducted one.</p>
                   <div class="table-wrap"><table class="data-table table-cards no-toggle">
                    <thead><tr><th>Pay period</th><th>Deducted</th><th>Balance before</th><th>Balance after</th></tr></thead>
                    <tbody>${slips.map(s => `<tr>
                      <td data-label="Pay period" style="font-size:12px;white-space:nowrap">${_epEsc(s.payPeriodStart || '')} – ${_epEsc(s.payPeriodEnd || '')}</td>
                      <td data-label="Deducted">₱${_epFmt(s.deductions?.other?.cashAdvance)}</td>
                      <td data-label="Balance before">₱${_epFmt(s.caBalanceBefore)}</td>
                      <td data-label="Balance after">₱${_epFmt(s.caBalanceAfter)}</td>
                    </tr>`).join('')}</tbody></table></div>`
                : `<div class="empty-state" style="padding:22px"><p style="font-size:12px">${slipRes.ok ? 'No cash-advance deductions on this worker’s payslips.' : 'Payslips are outside your access.'}</p></div>`)
            : `<div class="empty-state" style="padding:22px"><p style="font-size:12px">No repayments recorded.</p></div>`}
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [tb] });
}

/* ── TAB 4 — PAYROLL HISTORY (read-only) ──────────────────────────────
   Two teams, two collections, two id spaces:
     salary_history keyed on userId (an auth uid), written at monthly disburse
     payslips       keyed on workerId (a worker_profiles docId), weekly
   Both are shown when both exist, each labelled, so a person who has been in
   both populations sees an honest picture rather than half of one.
   ───────────────────────────────────────────────────────────────────── */
async function _epTabHistory(tb, ctx) {
  const { P, uid, workerId, canMoney, panel } = ctx;
  if (!canMoney) {
    tb.innerHTML = _epWithheldCard('Payroll history',
      'Payslips and monthly pay records are limited to the President, a Manager and the Accountant. They are withheld here rather than shown as an empty history.');
    return;
  }
  tb.innerHTML = window.skeletonHtml ? window.skeletonHtml('table') : '';

  const [histRes, slipRes] = await Promise.all([
    uid ? _epRead(db.collection('salary_history').where('userId', '==', uid)
                    .orderBy('month', 'desc').limit(12).get(), { docs: [] })
        : Promise.resolve({ ok: true, value: { docs: [] } }),
    workerId ? _epRead(db.collection('payslips').where('workerId', '==', workerId)
                        .orderBy('createdAt', 'desc').limit(12).get(), { docs: [] })
             : Promise.resolve({ ok: true, value: { docs: [] } })
  ]);
  if (!panel.isConnected) return;

  const hist = (histRes.value.docs || []).map(d => ({ id: d.id, ...d.data() }));
  const slips = (slipRes.value.docs || []).map(d => ({ id: d.id, ...d.data() }));

  const monthly = !histRes.ok
    ? `<div class="empty-state" style="padding:22px"><p style="font-size:12px">${histRes.denied ? 'Monthly pay history is outside your access.' : 'Could not load monthly pay history.'}</p></div>`
    : !hist.length
      ? `<div class="empty-state" style="padding:22px"><p style="font-size:12px">No monthly pay records yet.</p></div>`
      : `<div class="table-wrap"><table class="data-table table-cards no-toggle">
          <thead><tr><th>Month</th><th>Base</th><th>Allowance</th><th>Deductions</th><th>Cash adv.</th><th>Final pay</th></tr></thead>
          <tbody>${hist.map(h => `<tr>
            <td data-label="Month" style="white-space:nowrap;font-weight:600">${_epEsc(h.month || '—')}</td>
            <td data-label="Base">₱${_epFmt(h.salary)}</td>
            <td data-label="Allowance">₱${_epFmt(h.allowance)}</td>
            <td data-label="Deductions">₱${_epFmt(h.deductions)}</td>
            <td data-label="Cash adv.">₱${_epFmt(h.caDeducted)}</td>
            <td data-label="Final pay" style="font-weight:700">₱${_epFmt(h.finalPay != null ? h.finalPay : h.netPay)}</td>
          </tr>`).join('')}</tbody></table></div>`;

  const weekly = !slipRes.ok
    ? `<div class="empty-state" style="padding:22px"><p style="font-size:12px">${slipRes.denied ? 'Payslips are outside your access.' : 'Could not load payslips.'}</p></div>`
    : !slips.length
      ? `<div class="empty-state" style="padding:22px"><p style="font-size:12px">No weekly payslips yet.</p></div>`
      : `<div class="table-wrap"><table class="data-table table-cards no-toggle">
          <thead><tr><th>Pay period</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Paid</th></tr></thead>
          <tbody>${slips.map(s => `<tr>
            <td data-label="Pay period" style="white-space:nowrap;font-size:12px">${_epEsc(s.payPeriodStart || '')} – ${_epEsc(s.payPeriodEnd || '')}</td>
            <td data-label="Gross">₱${_epFmt(s.grossPay)}</td>
            <td data-label="Deductions">₱${_epFmt(s.totalDeductions)}</td>
            <td data-label="Net" style="font-weight:700">₱${_epFmt(s.netPay != null ? s.netPay : s.totalPay)}</td>
            <td data-label="Paid"><span class="badge ${s.paid ? 'badge-green' : 'badge-gray'}">${s.paid ? 'Paid' : 'Unpaid'}</span></td>
          </tr>`).join('')}</tbody></table></div>`;

  tb.innerHTML = `
    ${(uid || hist.length) ? `<div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>Monthly — Office Team</h3></div>
      <div class="card-body" style="padding:0">${monthly}</div>
    </div>` : ''}
    ${(workerId || slips.length) ? `<div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>Weekly — Operations Team</h3></div>
      <div class="card-body" style="padding:0">${weekly}</div>
    </div>` : ''}
    <p style="font-size:11px;color:var(--text-muted)">Read-only. Pay records are written by the pay run and can only be removed with the President’s approval.</p>`;
  if (window.lucide) lucide.createIcons({ nodes: [tb] });
}

/* ═══════════════════════════════════════════════════════════════════════
   ONE ROSTER — HR → Employee Profiles
   Both teams in a single searchable list, because the owner asked for the
   profile to be "uniform for office and operations team". Office Team staff
   come from users/{uid}; Operations Team staff come from worker_profiles, with
   anyone already linked via linkedUid folded into their user row rather than
   listed twice — the same linkedUid join every other screen uses.

   Reads worker_profiles best-effort: it is money-tier, so for the Corporate
   Secretary this list is the Office Team only, and it SAYS so instead of
   quietly showing half the company.
   ═══════════════════════════════════════════════════════════════════════ */

// Who may put an offboarded person back. Owner ruling 2026-08-12: "hr should
// be able to reinstate those offboarded".
//
// This is deliberately the SAME expression as renderTeamTab's canManageAccounts
// (js/screens/people.js) — president/manager by ROLE, or membership of the HR
// DEPARTMENT. HR already held this permission there; what it lacked was a door,
// because HR → Accounts & Logins is gated on `canAccounts` (role only), so a
// person actually assigned to HR could not reach the one screen that had the
// button. Duplicating the rule here rather than inventing a looser one keeps a
// single answer to "who may reinstate"; if it ever moves, move both.
function _epCanReinstate() {
  const role = window.currentRole;
  return ['president', 'manager'].includes(role)
    || (Array.isArray(window.currentDepts) && window.currentDepts.includes('HR'));
}

// The open roster, remembered so a save made in a panel ON TOP of it can put
// the list back in step. Owner, 2026-08-13: "when im changing their employment
// type, it does not save". It did save — every time. The editor writes, toasts,
// and reopens the PROFILE against the fresh doc, so the value was right there.
// But the ROSTER underneath was painted once, reads Firestore directly (no
// cache to invalidate), and was never repainted — so closing back to the list
// showed the old value, which is indistinguishable from the save having failed.
// `var`, not `const`: file-scope binding in a classic script (see the header).
var _epRosterPanel = null;

window.renderEmployeeProfiles = function () {
  const panel = window.openPage(
    `${_epIcon('🪪', 16)} Employee Profiles`,
    window.skeletonHtml ? window.skeletonHtml('table') : '<p>Loading…</p>',
    `<button class="btn-secondary" onclick="closeModal()">Close</button>`
  );
  const body = panel.querySelector('.page-panel-body');
  _epRosterPanel = panel;
  _epLoadRoster(panel, body);
  return panel;
};

// Repaint the roster if one is still open. Cheap and safe: no-ops when the list
// was never opened or has since been dismissed, and _epLoadRoster already
// bails on a detached panel, so a race with a closing list cannot paint a
// corpse.
function _epRefreshRosterIfOpen() {
  const p = _epRosterPanel;
  if (!p || !p.isConnected) return;
  const body = p.querySelector('.page-panel-body');
  if (body) _epLoadRoster(p, body);
}

async function _epLoadRoster(panel, body) {
  const [usersRes, wpRes] = await Promise.all([
    _epRead(
      typeof window.fetchUsersWithPayroll === 'function'
        ? window.fetchUsersWithPayroll()
        : db.collection('users').get(),
      { docs: [] }),
    _epRead(db.collection('worker_profiles').get(), { docs: [] })
  ]);
  if (!panel.isConnected) return;

  // fetchUsersWithPayroll stamps this when the payroll LIST was refused: every
  // row's payClass is then missing BY PERMISSION, not because it is unset.
  const payrollDenied = !!(usersRes.value && usersRes.value.payrollDenied);

  // Owner ruling 2026-08-12: "dont include brilliant steel or partners on the
  // payroll or hr". This is an HR screen, so the same predicate the payroll
  // roster and the HR roster use applies here — it was filtering `role !==
  // 'partner'` ALONE, which let a Brilliant-Steel-only member with an
  // 'employee' role onto an HR list (observed: one on the owner's screen).
  const users = (usersRes.value.docs || []).map(d => ({ id: d.id, ...d.data() }))
    .filter(u => (typeof window.isExternalPartnerUser === 'function')
      ? !window.isExternalPartnerUser(u)
      : u.role !== 'partner');
  const wps = (wpRes.value.docs || []).map(d => ({ id: d.id, ...d.data() }));
  const linked = new Set(wps.filter(w => w.linkedUid).map(w => w.linkedUid));
  const wpByUid = {};
  wps.forEach(w => { if (w.linkedUid) wpByUid[w.linkedUid] = w; });

  const rows = users.map(u => {
    const w = wpByUid[u.id] || null;
    const isOps = u.payClass === 'production' || !!w;
    // Both halves of the pay identity unreadable -> `isOps` is false by default,
    // not by evidence. Don't print "Office" over a hole in the data.
    const payClassKnown = isOps || !!u.payClass || !(payrollDenied && !wpRes.ok);
    return {
      uid: u.id, workerId: w ? w.id : '', payClassKnown,
      name: u.displayName || u.email || '(unnamed)',
      title: u.title || (w ? w.jobTitle : '') || '',
      dept: (Array.isArray(u.departments) && u.departments.length ? u.departments : (u.department ? [u.department] : [])).join(', '),
      id: u.employeeId || (w ? w.idNumber : '') || '',
      status: u.employmentStatus || (w ? w.employmentStatus : '') || '',
      startDate: u.startDate || (w ? (w.startDate || w.issuedOn) : '') || '',
      isOps, removed: u.removed === true
    };
  }).concat(
    // Operations staff with NO login at all — the majority today. They are only
    // reachable by worker_profiles docId, never by uid.
    wps.filter(w => !w.linkedUid || !users.some(u => u.id === w.linkedUid)).map(w => ({
      uid: '', workerId: w.id,
      name: w.name || '(unnamed)',
      title: w.jobTitle || '',
      dept: w.department || '',
      id: w.idNumber || '',
      status: w.employmentStatus || '',
      startDate: w.startDate || w.issuedOn || '',
      isOps: true, payClassKnown: true, removed: w.status === 'inactive'
    }))
  ).sort((a, b) => a.name.localeCompare(b.name));

  const canMoney = (typeof window.isMoneyPriv === 'function') ? window.isMoneyPriv() : true;

  body.innerHTML = `
    ${!wpRes.ok ? `<div class="alert-banner" style="cursor:default;margin-bottom:12px"><span>${_epIcon('🔒', 16)} <strong>Office Team only.</strong> Operations Team worker records are limited to the President, a Manager and the Accountant, so they are not listed here${canMoney ? '' : ' for your role'} — rather than being silently omitted.</span></div>` : ''}
    <div class="form-group" style="margin-bottom:12px">
      <label for="ep-search">Search</label>
      <input id="ep-search" placeholder="Name, job title, department or ID" autocomplete="off"/>
    </div>
    <div class="card"><div class="card-body" style="padding:0">
      <div class="table-wrap"><table class="data-table table-cards no-toggle" id="ep-roster">
        <thead><tr><th>Name</th><th>Job title</th><th>Department</th><th>Status</th><th>Team</th><th>Since</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.map((r, i) => {
          const st = window.employmentStatusMeta ? window.employmentStatusMeta(r.status) : { label: r.status || '—', badge: 'badge-gray' };
          return `<tr data-i="${i}" data-hay="${_epEsc((r.name + ' ' + r.title + ' ' + r.dept + ' ' + r.id).toLowerCase())}">
            <td data-label="Name" style="font-weight:700">${_epEsc(r.name)}${r.removed ? ' <span class="badge badge-red">Offboarded</span>' : ''}</td>
            <td data-label="Job title" style="font-size:12px">${_epEsc(r.title || '—')}</td>
            <td data-label="Department" style="font-size:12px">${_epEsc(r.dept || '—')}</td>
            <td data-label="Status"><span class="badge ${_epEsc(st.badge)}">${_epEsc(st.label)}</span></td>
            <td data-label="Team">${r.payClassKnown
              ? `<span class="badge ${r.isOps ? 'badge-orange' : 'badge-blue'}">${r.isOps ? 'Operations' : 'Office'}</span>`
              : `<span class="badge badge-gray" title="Pay records and the Operations worker register are both closed to your role.">Withheld</span>`}</td>
            <td data-label="Since" style="font-size:12px;white-space:nowrap">${_epEsc(r.startDate || '—')}</td>
            <td data-label=""><button class="btn-secondary btn-sm ep-open" data-i="${i}" style="min-height:34px">Profile</button>${
              // Owner ruling 2026-08-12: "hr should be able to reinstate those
              // offboarded". The badge was shown here with no way to undo it —
              // the only Reinstate lived on the Team screen, whose door
              // (HR → Accounts & Logins) was role-gated away from the very
              // people asked to do this. Same gate as renderTeamTab's own
              // canManageAccounts so there is ONE answer to "who may reinstate".
              (r.removed && _epCanReinstate())
                ? ` <button class="btn-success btn-sm ep-reinstate" data-i="${i}" style="min-height:34px">Reinstate</button>` : ''
            }</td>
          </tr>`;
        }).join('') : `<tr><td colspan="7"><div class="empty-state" style="padding:26px"><p style="font-size:12px">${usersRes.ok ? 'Nobody on file.' : 'The staff list could not be loaded.'}</p></div></td></tr>`}
        </tbody>
      </table></div>
    </div></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [body] });

  // Every lookup scoped to this panel — never document.getElementById inside
  // an openPage panel.
  const search = body.querySelector('#ep-search');
  const tbody = body.querySelector('#ep-roster tbody');
  if (search && tbody) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      tbody.querySelectorAll('tr[data-hay]').forEach(tr => {
        tr.style.display = (!q || tr.dataset.hay.includes(q)) ? '' : 'none';
      });
    });
  }
  body.querySelectorAll('.ep-open').forEach(btn => btn.addEventListener('click', () => {
    const r = rows[+btn.dataset.i];
    if (r) window.openEmployeeProfile({ uid: r.uid, workerId: r.workerId, name: r.name });
  }));

  // ── Reinstate an offboarded person ──────────────────────────────────────
  // TWO DIFFERENT RECORDS wear the same "Offboarded" badge on this list and
  // they are un-done in completely different ways. Getting this wrong is
  // silent: the toast says reinstated and the person still cannot work.
  //
  //   Office Team / anyone with a login  -> users/{uid}.removed
  //     Routed through the setUserDisabled Cloud Function, NEVER a direct doc
  //     write. The function re-enables the Firebase Auth account itself; a
  //     client-side flag flip would leave the Auth account disabled, so the
  //     roster would say active while the person still could not sign in.
  //     (The remove direction has the mirror-image reason — it revokes refresh
  //     tokens so a live 10-day session cannot outlive the removal.)
  //
  //   Operations staff with no login     -> worker_profiles/{id}.status
  //     There is no Auth account to enable; 'inactive' is the whole of their
  //     offboarding, so the repair is the status field and nothing else.
  body.querySelectorAll('.ep-reinstate').forEach(btn => btn.addEventListener('click', () => window.busy(btn, async () => {
    const r = rows[+btn.dataset.i];
    if (!r) return;
    const ok = await window.confirmDialog({
      title: 'Reinstate ' + r.name + '?',
      message: r.uid
        ? _epEsc(r.name) + ' will be able to sign in again immediately, and will be back on the payroll roster for periods that have not been paid yet. Nothing about their past pay changes.'
        : _epEsc(r.name) + ' will be back on the Operations roster and can be clocked in again. Nothing about their past pay changes.',
      html: true,
      confirmLabel: 'Reinstate'
    });
    if (!ok) return;
    try {
      if (r.uid) {
        await firebase.functions().httpsCallable('setUserDisabled')({ targetUid: r.uid, disabled: false });
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('users');
      } else if (r.workerId) {
        await db.collection('worker_profiles').doc(r.workerId).update({
          status: 'active',
          reinstatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          reinstatedBy: (window.currentUser && window.currentUser.uid) || null
        });
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('worker_profiles');
      } else {
        Notifs.showToast('This record carries no id, so it cannot be reinstated from here.', 'error');
        return;
      }
      window.logAudit && window.logAudit('reinstate', r.uid ? 'user' : 'worker_profile', r.uid || r.workerId, { name: r.name });
      Notifs.success(r.name + ' reinstated.');
      // Repaint IN PLACE so the badge and the button clear. Not
      // renderEmployeeProfiles() — that opens a SECOND roster on top of the
      // one you are standing on, and closing it drops you back onto the stale
      // first copy still showing "Offboarded".
      _epRefreshRosterIfOpen();
    } catch (err) {
      Notifs.showToast('Could not reinstate: ' + (err.message || err.code || err), 'error');
    }
  })));
}

/* ═══════════════════════════════════════════════════════════════════════
   ⚠ KNOWN: THERE IS A SECOND, UNAPPROVED WAY TO CHANGE SALARY
   openEditEmployeeModal (js/screens/dashboards.js — the Team tab's pencil)
   writes payroll.salary DIRECTLY from an `eu-salary` input: no RaiseFlow, no
   pending_raises, no President approval and no salary_raises audit row. The
   Edit Payroll modal and the HR worker form both went read-only for rates
   precisely to close that door; this one was missed. This profile deliberately
   does not become a third door — it routes every rate change through
   openSalaryRaiseModal. Fixing openEditEmployeeModal is a separate change with
   its own blast radius (it is the only salary editor some HR flows use today),
   so it is reported rather than silently altered here.
   ═══════════════════════════════════════════════════════════════════════ */
