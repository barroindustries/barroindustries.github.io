/* ═══════════════════════════════════════════════════════════════════════
   GOVERNMENT CONTRIBUTION RATES — Finance → Taxes & BIR → Gov Rates
   window.renderStatutoryRatesTab(container, currentUser, currentRole)

   WHY THIS EXISTS. js/statutory-tables.js ships PLACEHOLDER SSS / PhilHealth /
   Pag-IBIG / withholding figures marked `verified: false`, and disbursePayRun
   refuses to pay while that flag is false (js/departments.js). The gate is
   right — paying real wages on invented government rates, and remitting the
   wrong amounts, is worse than paying late. But the flag lived in a SOURCE FILE
   and nothing in the app could write it, so the only way to satisfy the gate was
   a code deploy, which the person who actually knows the rates (an accountant)
   cannot do. The Office Team payroll has therefore been unpayable all year.

   This screen is the missing route out. The rates are entered here, attested
   here, and stored in Firestore (statutory_tables/{year}), which
   window.loadStatutoryTables merges over the placeholder at boot.

   ⚠ THIS FILE INVENTS NO NUMBERS. Every field is pre-filled from whatever is
   currently loaded and is labelled as placeholder until a human replaces it.
   The values that ship in statutory-tables.js are explicitly marked PLACEHOLDER
   in that file; they are shown here only so the shape is familiar and the
   person can see what they are correcting. Nobody — not this screen, not the
   assistant that wrote it — can know the current circulars. That is the whole
   point of the attestation.

   PRESIDENT-ONLY WRITE, enforced in firestore.rules. One document decides what
   every employee is paid and what is remitted to government; it is the
   highest-leverage record in the app.
   ═══════════════════════════════════════════════════════════════════════ */

window.renderStatutoryRatesTab = async function (container, currentUser, currentRole) {
  const c = container || (typeof deptContainer === 'function' ? deptContainer() : null);
  if (!c) return;
  const esc = (v) => (window.escHtml ? window.escHtml(v == null ? '' : v) : String(v == null ? '' : v));
  const ico = (g, s) => (window.emojiIcon ? window.emojiIcon(g, s || 16) : '');
  const canWrite = (typeof isRealPresident === 'function') ? isRealPresident() : false;

  c.innerHTML = window.skeletonHtml ? window.skeletonHtml('rows') : '<p>Loading…</p>';

  const year = String((window.bizYear ? window.bizYear() : new Date().getFullYear()));
  let stored = null, readFailed = false;
  try {
    const d = await db.collection('statutory_tables').doc(year).get();
    stored = d.exists ? d.data() : null;
  } catch (_) { readFailed = true; }
  if (!c.isConnected) return;

  // What is live RIGHT NOW — stored if present, otherwise the placeholder.
  const T = (window.STATUTORY && window.STATUTORY[year]) || {};
  const verified = T.verified === true;

  const num = (id, label, val, hint) => `
    <div class="form-group">
      <label for="${id}">${esc(label)}</label>
      <input id="${id}" type="number" step="any" value="${esc(val == null ? '' : val)}"${canWrite ? '' : ' disabled'}/>
      ${hint ? `<p style="font-size:11px;color:var(--text-muted);margin-top:3px">${esc(hint)}</p>` : ''}
    </div>`;

  const sss = T.sss || {}, ph = T.philhealth || {}, pi = T.pagibig || {};

  c.innerHTML = `
    <div class="page-header"><h2>${ico('🏛', 20)} Government Contribution Rates — ${esc(year)}</h2></div>

    ${verified
      ? `<div class="alert-banner" style="cursor:default;background:rgba(47,158,68,.10);border-color:var(--success);margin-bottom:14px">
           <span>${ico('✅', 16)} <strong>${esc(year)} rates are confirmed.</strong> Payroll can be released.
           Confirmed by ${esc(T.verifiedByName || T.verifiedBy || '—')}${T.verifiedAtLabel ? ' on ' + esc(T.verifiedAtLabel) : ''}.
           Source: ${esc(T.source || '—')}</span>
         </div>`
      : `<div class="alert-banner" style="cursor:default;background:rgba(230,73,128,.10);border-color:var(--danger);margin-bottom:14px">
           <span>${ico('⛔', 16)} <strong>Payroll cannot be released for ${esc(year)}.</strong>
           The figures below are <strong>placeholders shipped with the app</strong> — they are NOT the ${esc(year)} rates and
           must not be used to pay anyone. Whoever files your BIR returns should confirm or correct every number here,
           then press Confirm. Nothing else unblocks payroll.</span>
         </div>`}

    ${readFailed ? `<div class="alert-banner" style="cursor:default;margin-bottom:12px"><span>${ico('⚠', 16)} The saved rates could not be read, so what is shown is the app's built-in placeholder. Reload before confirming.</span></div>` : ''}

    ${!canWrite ? `<div class="alert-banner" style="cursor:default;margin-bottom:12px"><span>${ico('🔒', 16)} Only the President can confirm rates — this is the one record that decides what everyone is paid and what is remitted. You can read them here.</span></div>` : ''}

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>SSS</h3></div>
      <div class="form-row">${num('sr-sss-ee', 'Employee share (rate)', sss.rateEE, 'e.g. 0.05 for 5%')}${num('sr-sss-er', 'Employer share (rate)', sss.rateER, '')}</div>
      <div class="form-row">${num('sr-sss-min', 'Salary credit — minimum', sss.mscMin, '')}${num('sr-sss-max', 'Salary credit — maximum', sss.mscMax, '')}</div>
      <div class="form-row">${num('sr-sss-step', 'Bracket step', sss.mscStep, '')}${num('sr-sss-mpf', 'MPF / WISP threshold', sss.mpfThreshold, '')}</div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>PhilHealth</h3></div>
      <div class="form-row">${num('sr-ph-rate', 'Premium rate', ph.rate, 'e.g. 0.05 for 5%')}${num('sr-ph-split', 'Employee share of premium', ph.split, '0.5 = half')}</div>
      <div class="form-row">${num('sr-ph-floor', 'Income floor', ph.floor, '')}${num('sr-ph-ceiling', 'Income ceiling', ph.ceiling, '')}</div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Pag-IBIG</h3></div>
      <div class="form-row">${num('sr-pi-ee', 'Employee share (rate)', pi.rateEE, '')}${num('sr-pi-er', 'Employer share (rate)', pi.rateER, '')}</div>
      <div class="form-row">${num('sr-pi-base', 'Base cap', pi.base, '')}${num('sr-pi-max', 'Employee maximum (₱)', pi.maxEE, '')}</div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Withholding tax — monthly brackets</h3></div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">One row per bracket: income over, base tax, and the rate on the excess. Leave as-is if unchanged.</p>
      <div id="sr-wh-rows"></div>
    </div>

    ${canWrite ? `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Confirm</h3></div>
      <div class="form-group">
        <label for="sr-source">Where these came from <span style="color:var(--danger)">*</span></label>
        <input id="sr-source" placeholder="e.g. SSS Circular 2026-001, PhilHealth Advisory 2026-0003, BIR RR 8-2018" value="${esc(stored && stored.source ? stored.source : '')}"/>
        <p style="font-size:11px;color:var(--text-muted);margin-top:3px">Recorded on the rates so anyone reconciling a payslip a year from now can see the authority they were based on.</p>
      </div>
      <label class="check-row"><input type="checkbox" id="sr-attest"/><span>I confirm these are the current ${esc(year)} government rates.</span></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn-primary" id="sr-save">${ico('✅', 14)} Confirm rates &amp; unblock payroll</button>
      </div>
    </div>` : ''}

    <div id="sr-status-section" style="margin-top:18px"></div>
    <div id="sr-taskbased-section" style="margin-top:18px"></div>
  `;

  // ── withholding rows ──
  const whHost = c.querySelector('#sr-wh-rows');
  const wh = Array.isArray(T.withholdingMonthly) ? T.withholdingMonthly : [];
  const drawWh = () => {
    whHost.innerHTML = wh.map((r, i) => `
      <div class="form-row" style="align-items:end">
        ${num(`sr-wh-o-${i}`, i === 0 ? 'Over' : '', r.over, '')}
        ${num(`sr-wh-b-${i}`, i === 0 ? 'Base tax' : '', r.base, '')}
        ${num(`sr-wh-r-${i}`, i === 0 ? 'Rate on excess' : '', r.rate, '')}
      </div>`).join('');
  };
  drawWh();
  if (window.lucide) lucide.createIcons({ nodes: [c] });

  // STATUTORY-BY-STATUS-SPEC-2026-08-12 §6 — the report + switch. A separate
  // top-level function (below) so it can repaint ITSELF after the switch is
  // toggled, without re-running the rates form's own reads/writes above.
  // Rendered for every viewer (canWrite gates only the toggle button, same
  // as the rest of this screen) — the report is meant to be seen before
  // anyone adopts the rule.
  const statusHost = c.querySelector('#sr-status-section');
  if (statusHost) window.renderStatutoryStatusSection(statusHost, canWrite, currentUser);

  // TASK-BASED-PAY-SPEC-2026-08-12 §7 — the report + minimum-wage floor +
  // switch. Order per §11.3: rates form -> status section (above) -> this
  // section. Neither depends on the other's state. A separate top-level
  // function (below) so it can repaint ITSELF after the floor is saved or the
  // switch is toggled, without re-running the rates form's own reads/writes.
  const taskBasedHost = c.querySelector('#sr-taskbased-section');
  if (taskBasedHost) window.renderTaskBasedPaySection(taskBasedHost, currentUser, currentRole);

  if (!canWrite) return;

  // EVERY lookup scoped to this container — #sr-* ids are not unique across the
  // page stack, and a dying panel would win a document-wide getElementById.
  const $ = (id) => c.querySelector('#' + id);
  const val = (id) => { const v = $(id) ? $(id).value : ''; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

  $('sr-save').addEventListener('click', () => window.busy($('sr-save'), async () => {
    const source = ($('sr-source').value || '').trim();
    if (!source) { Notifs.showToast('Say where these rates came from — it is recorded on the payslips they produce.', 'error'); return; }
    if (!$('sr-attest').checked) { Notifs.showToast('Tick the confirmation before these can be used to pay anyone.', 'error'); return; }

    // Refuse a blank field rather than storing a silent zero: a 0 rate here
    // means "deduct nothing", which files a wrong return rather than failing.
    const need = {
      'sr-sss-ee': 'SSS employee share', 'sr-sss-er': 'SSS employer share',
      'sr-sss-min': 'SSS minimum', 'sr-sss-max': 'SSS maximum', 'sr-sss-step': 'SSS bracket step',
      'sr-ph-rate': 'PhilHealth rate', 'sr-ph-split': 'PhilHealth employee share',
      'sr-ph-floor': 'PhilHealth floor', 'sr-ph-ceiling': 'PhilHealth ceiling',
      'sr-pi-ee': 'Pag-IBIG employee share', 'sr-pi-er': 'Pag-IBIG employer share',
      'sr-pi-base': 'Pag-IBIG base cap', 'sr-pi-max': 'Pag-IBIG employee maximum'
    };
    const blank = Object.keys(need).filter(k => val(k) === null);
    if (blank.length) { Notifs.showToast('Missing: ' + blank.map(k => need[k]).join(', '), 'error'); return; }

    const rows = wh.map((_, i) => ({ over: val(`sr-wh-o-${i}`) || 0, base: val(`sr-wh-b-${i}`) || 0, rate: val(`sr-wh-r-${i}`) || 0 }));

    const body = {
      verified: true, source,
      verifiedBy: (window.currentUser && currentUser.uid) || '',
      verifiedByName: (window.userProfile && userProfile.displayName) || '',
      verifiedAtLabel: (window.bizDate ? window.bizDate() : ''),
      verifiedAt: firebase.firestore.FieldValue.serverTimestamp(),
      sss: { rateEE: val('sr-sss-ee'), rateER: val('sr-sss-er'), mscMin: val('sr-sss-min'),
             mscMax: val('sr-sss-max'), mscStep: val('sr-sss-step'), mpfThreshold: val('sr-sss-mpf') || 0 },
      philhealth: { rate: val('sr-ph-rate'), split: val('sr-ph-split'), floor: val('sr-ph-floor'), ceiling: val('sr-ph-ceiling') },
      pagibig: { rateEE: val('sr-pi-ee'), rateER: val('sr-pi-er'), base: val('sr-pi-base'), maxEE: val('sr-pi-max') },
      withholdingMonthly: rows
    };

    try {
      await db.collection('statutory_tables').doc(year).set(body, { merge: true });
      await window.loadStatutoryTables();          // live, no reload needed
      window.logAudit && window.logAudit('update', 'statutory_tables', year, { source, verified: true });
      Notifs.success(`${year} rates confirmed — payroll can now be released.`);
      window.renderStatutoryRatesTab(c, currentUser, currentRole);
    } catch (e) {
      Notifs.showToast('Could not save: ' + (e.message || e.code || e), 'error');
    }
  }));
};

/* ═══════════════════════════════════════════════════════════════════════
   STATUTORY-BY-STATUS-SPEC-2026-08-12 §6 — "Employment status decides
   government deductions": the report + the President-gated switch.

   Nothing here writes payroll. The ONLY write in this whole section is the
   switch doc (settings/payrollStatutoryStatus), already President-write /
   staff-read under the existing settings/{docId} rule — zero rules changes.
   Every money figure below is a PREVIEW, computed by calling
   window.statutoryStatusPlan(person, true, opts) — the middle "enabled"
   argument forced true — regardless of the stored switch value. That is
   what makes "Who changes" a preview the
   owner can read before adopting the rule, per the design's central safety
   property (spec §2/§5.2).
   ═══════════════════════════════════════════════════════════════════════ */
window.renderStatutoryStatusSection = async function (container, canWrite, currentUser) {
  if (!container) return;
  const esc = (v) => (window.escHtml ? window.escHtml(v == null ? '' : v) : String(v == null ? '' : v));
  const ico = (g, s) => (window.emojiIcon ? window.emojiIcon(g, s || 16) : '');
  const peso = (v) => (window.fmt ? window.fmt(v) : ('₱' + (Number(v) || 0).toFixed(2)));

  container.innerHTML = window.skeletonHtml ? window.skeletonHtml('rows') : '<p>Loading…</p>';

  // ── the switch's stored state ──────────────────────────────────────────
  let switchDoc = null, switchReadFailed = false;
  try {
    const d = await db.collection('settings').doc('payrollStatutoryStatus').get();
    switchDoc = d.exists ? d.data() : null;
  } catch (_) { switchReadFailed = true; }
  if (!container.isConnected) return;
  const switchOn = !!(switchDoc && switchDoc.enabled === true);

  // ── roster reads ────────────────────────────────────────────────────────
  // Same "an external partner is not on payroll" filter buildPayRunLines uses
  // (js/departments.js), so this report's roster matches the real pay run's.
  const _isExternalPartner = (u) => {
    if (u.role === 'partner') return true;
    if (typeof u.title === 'string' && u.title.trim().toLowerCase() === 'partner') return true;
    const depts = Array.isArray(u.departments) ? u.departments : (u.department ? [u.department] : []);
    return depts.length === 1 && depts[0] === 'Brilliant Steel';
  };

  let officeDocs = [], payrollDenied = false, officeReadFailed = false;
  try {
    const usersRes = await window.fetchUsersWithPayroll();
    officeDocs = usersRes.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => !_isExternalPartner(u));
    payrollDenied = !!usersRes.payrollDenied;
  } catch (_) { officeReadFailed = true; }

  let opsDocs = [], opsReadFailed = false;
  try {
    const wpSnap = await db.collection('worker_profiles').get();
    opsDocs = wpSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.status !== 'inactive' && !p.removed);
  } catch (_) { opsReadFailed = true; }
  if (!container.isConnected) return;

  // ── this year's table, for the preview only — never for pay ────────────
  const year = (window.bizYear ? window.bizYear() : new Date().getFullYear());
  const yearTable = (window.STATUTORY && window.STATUTORY[String(year)]) || {};
  const tableVerified = yearTable.verified === true;

  // ── the preview: plan.active === true regardless of the stored switch ──
  const officeRows = officeDocs.map((u) => {
    const plan = window.statutoryStatusPlan
      ? window.statutoryStatusPlan(u, true, { engine: 'month' })
      : { active: false, statConfig: null, status: '', perKey: {}, words: '', flag: null };
    let table = null, today = null, underRule = null;
    if (!payrollDenied && window.computeStatutory && window.resolveStatutoryEE) {
      table = window.computeStatutory({ grossPay: (u.salary || 0) + (u.allowance || 0), year });
      today = window.resolveStatutoryEE(u, table);
      underRule = plan.active ? window.resolveStatutoryEE({ ...u, statConfig: plan.statConfig }, table) : today;
    }
    return { id: u.id, uid: u.id, workerId: '', name: u.displayName || u.email || 'Unnamed person', team: 'Office Team', plan, today, underRule };
  });
  const opsRows = opsDocs.map((p) => {
    const plan = window.statutoryStatusPlan
      ? window.statutoryStatusPlan(p, true, { engine: 'week' })
      : { active: false, statConfig: null, status: '', perKey: {}, words: '', flag: null };
    return { id: p.id, uid: '', workerId: p.id, name: p.name || p.id, team: 'Operations Team', plan, today: null, underRule: null };
  });
  const allRows = officeRows.concat(opsRows);

  // "Who changes" (truth-table rows 8/9 ONLY) — Office Team, where a
  // derived exemption is a REAL peso change. The weekly side never changes a
  // number (spec §4) — an active plan there is words/flags only.
  const changing = officeRows.filter(r => r.plan.active && r.today && r.underRule &&
    (r.today.sss !== r.underRule.sss || r.today.philhealth !== r.underRule.philhealth || r.today.pagibig !== r.underRule.pagibig));

  // "Needs a decision" — bucketed by flag kind, single most important issue
  // per person already resolved by statutoryStatusPlan.
  const byFlag = { 'status-unset': [], 'status-unknown': [], 'status-ended': [], 'regular-unconfigured': [], 'typed-on-nonregular': [] };
  allRows.forEach(r => { if (r.plan.flag && byFlag[r.plan.flag.kind]) byFlag[r.plan.flag.kind].push(r); });

  const fixLink = (r) => `<button type="button" class="btn-secondary btn-sm sr-status-fix" data-uid="${esc(r.uid)}" data-workerid="${esc(r.workerId)}" data-name="${esc(r.name)}">${esc(r.name)}</button>`;

  const stateLine = switchOn
    ? `<div class="py-sub" style="margin:6px 0 10px">On since ${esc(switchDoc.changedAtLabel || '—')} — turned on by ${esc(switchDoc.changedByName || '—')}.</div>`
    : `<div class="py-sub" style="margin:6px 0 10px">Off — nothing below has changed anyone's deductions yet.</div>`;

  const toggleBtnHtml = canWrite
    ? `<button class="btn-primary btn-sm" id="sr-status-toggle">${switchOn ? 'Turn this off' : 'Turn this on'}</button>`
    : `<span class="badge ${switchOn ? 'badge-green' : 'badge-gray'}" style="font-size:11px">${switchOn ? 'On' : 'Off'}</span>
       <p style="font-size:11px;color:var(--text-muted);margin-top:4px">${ico('🔒', 12)} Only the President can turn this on or off.</p>`;

  const changingRowsHtml = changing.length
    ? changing.map(r => `
        <div class="py-problem">
          <div class="py-ptext"><strong>${esc(r.name)}</strong> — ${esc(r.team)} — <span class="badge ${esc((window.employmentStatusMeta ? window.employmentStatusMeta(r.plan.status).badge : 'badge-gray'))}" style="font-size:10px">${esc(window.employmentStatusMeta ? window.employmentStatusMeta(r.plan.status).label : (r.plan.status || 'Not set'))}</span><br/>
            SSS ${peso(r.today.sss)} → ${peso(r.underRule.sss)} · PhilHealth ${peso(r.today.philhealth)} → ${peso(r.underRule.philhealth)} · Pag-IBIG ${peso(r.today.pagibig)} → ${peso(r.underRule.pagibig)}
          </div>
        </div>`).join('')
    : `<div class="py-sub">Nobody's deductions change right now.</div>`;

  const needsDecisionBlock = (title, caption, rows) => {
    if (!rows.length) return '';
    return `<div style="margin-bottom:12px">
      <div class="py-sub" style="font-weight:600;color:var(--text)">${esc(title)} (${rows.length})</div>
      ${caption ? `<div class="py-sub" style="margin-bottom:4px">${esc(caption)}</div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:6px">${rows.map(fixLink).join('')}</div>
    </div>`;
  };
  const unknownCaption = byFlag['status-unknown'].length
    ? ' Unrecognised value on file: ' + byFlag['status-unknown'].map(r => `"${esc(r.plan.status)}"`).join(', ') + '.'
    : '';
  const needsDecisionHtml = [
    needsDecisionBlock('Status not set', 'Set their employment status on their HR record.' + unknownCaption, byFlag['status-unset'].concat(byFlag['status-unknown'])),
    needsDecisionBlock('Employment ended but still on payroll', 'Final pay: government deductions stay unchanged until the owner decides.', byFlag['status-ended']),
    needsDecisionBlock('Regular Operations workers with no statutory setup', 'Nothing is being deducted for them.', byFlag['regular-unconfigured']),
    needsDecisionBlock('Non-regular with hand-set amounts', 'Hand-set amounts win over the status rule.', byFlag['typed-on-nonregular'])
  ].join('');
  const hasNeedsDecision = byFlag['status-unset'].length || byFlag['status-unknown'].length || byFlag['status-ended'].length ||
    byFlag['regular-unconfigured'].length || byFlag['typed-on-nonregular'].length;

  const sourceWord = (r) => {
    const p = r.plan.perKey || {};
    const anyExplicit = ['sss', 'philhealth', 'pagibig'].some(k => p[k] === 'person');
    const anyTyped = ['sss', 'philhealth', 'pagibig'].some(k => p[k] === 'typed');
    const anyStatus = ['sss', 'philhealth', 'pagibig'].some(k => p[k] === 'status');
    if (anyStatus) return 'employment status';
    if (anyExplicit) return 'set by hand';
    if (anyTyped) return 'amount typed on record';
    return 'usual table';
  };
  const everyoneRowsHtml = allRows.length
    ? allRows.map(r => {
        const meta = window.employmentStatusMeta ? window.employmentStatusMeta(r.plan.status) : { label: r.plan.status || 'Not set', badge: 'badge-gray' };
        return `<div class="py-problem">
          <div class="py-ptext"><strong>${esc(r.name)}</strong> — ${esc(r.team)} — <span class="badge ${esc(meta.badge)}" style="font-size:10px">${esc(meta.label)}</span> — ${esc(sourceWord(r))}
          ${r.today ? ` — SSS ${peso(r.today.sss)} · PhilHealth ${peso(r.today.philhealth)} · Pag-IBIG ${peso(r.today.pagibig)}` : ''}
          </div>
        </div>`;
      }).join('')
    : `<div class="py-sub">Nobody on either roster yet.</div>`;

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Employment status decides government deductions</h3></div>
      <p style="font-size:13px;line-height:1.5">When this is on, a person whose employment status is Training or Probationary has no SSS, PhilHealth or Pag-IBIG taken, unless someone set amounts on their record by hand. Regular employees are unchanged. People with no status set are unchanged — set their status on their HR record. It takes effect the next time a pay period's figures are worked out; periods already paid are not touched.</p>
      ${switchReadFailed ? `<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${ico('⚠', 16)} Could not read the employment-status payroll setting — nothing below reflects whether it is actually on or off right now. Reload before deciding anything from this.</span></div>` : ''}
      ${stateLine}
      ${toggleBtnHtml}
      ${!tableVerified ? `<p style="font-size:11px;color:var(--text-muted);margin-top:10px">${ico('⚠', 12)} Amounts use this year's placeholder rates, which are not confirmed yet — see the rates form above.</p>` : ''}
      ${payrollDenied ? `<p style="font-size:11px;color:var(--text-muted);margin-top:6px">Office pay figures: not shown to you.</p>` : ''}
      ${officeReadFailed || opsReadFailed ? `<p style="font-size:11px;color:var(--danger);margin-top:6px">${ico('⚠', 12)} One or both rosters could not be read — this report is incomplete right now.</p>` : ''}
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Who changes</h3></div>
      <div class="card-body" style="padding-top:0">${changingRowsHtml}</div>
    </div>

    ${hasNeedsDecision ? `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Needs a decision</h3></div>
      <div class="card-body" style="padding-top:0">${needsDecisionHtml}</div>
    </div>` : ''}

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Everyone</h3></div>
      <div class="card-body" style="padding-top:0">${everyoneRowsHtml}</div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  container.querySelectorAll('.sr-status-fix').forEach(b => b.addEventListener('click', () => {
    if (typeof window.openEmployeeProfile !== 'function') { Notifs.showToast('The HR records screen could not be opened.', 'error'); return; }
    window.openEmployeeProfile({ uid: b.dataset.uid || undefined, workerId: b.dataset.workerid || undefined, name: b.dataset.name });
  }));

  const toggleBtn = container.querySelector('#sr-status-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => window.busy(toggleBtn, async () => {
      const nextOn = !switchOn;
      try {
        await db.collection('settings').doc('payrollStatutoryStatus').set({
          enabled: nextOn,
          changedBy: (currentUser && currentUser.uid) || '',
          changedByName: (window.userProfile && window.userProfile.displayName) || '',
          changedAtLabel: (window.bizDate ? window.bizDate() : ''),
          changedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        window.logAudit && window.logAudit('update', 'settings', 'payrollStatutoryStatus', { enabled: nextOn });
        Notifs.success(nextOn ? 'Employment status now decides government deductions.' : 'Employment status no longer decides government deductions.');
        window.renderStatutoryStatusSection(container, canWrite, currentUser);
      } catch (e) {
        Notifs.showToast('Could not save: ' + (e.message || e.code || e), 'error');
      }
    }));
  }
};

/* ═══════════════════════════════════════════════════════════════════════
   TASK-BASED-PAY-SPEC-2026-08-12 §7 — Office Team task-based pay: the
   explanation, the minimum-wage floor, the two-build preview, and the
   President-gated switch.

   The owner's formula (§0/§2): net × (0.7·task results + 0.3·on-time morning
   check-ins). Nothing here writes payroll directly — the only writes in this
   whole section are settings/payrollOfficePolicy (the switch) and
   settings/payrollWageFloor (the floor), both already President-write /
   staff-read under the existing settings/{docId} rule (zero rules changes).
   Every peso below is built through window.buildPayRunLines with an EXPLICIT
   policy argument — which bypasses the settings rung (§6.2) — so this is a
   preview regardless of the stored switch value, and it can never show a
   number the real engine wouldn't (never a second copy of the math).
   ═══════════════════════════════════════════════════════════════════════ */
window.renderTaskBasedPaySection = async function (container, currentUser, currentRole) {
  if (!container) return;
  // §7 visibility — same tier that sees the payroll screen. A Finance user
  // sees state read-only (canWrite below); anyone else sees nothing at all,
  // since the preview shows every office person's actual pay.
  const canSee = (typeof window.isMoneyPriv === 'function') ? window.isMoneyPriv() : false;
  if (!canSee) { container.innerHTML = ''; return; }

  const esc = (v) => (window.escHtml ? window.escHtml(v == null ? '' : v) : String(v == null ? '' : v));
  const ico = (g, s) => (window.emojiIcon ? window.emojiIcon(g, s || 16) : '');
  const peso = (v) => (window.fmtPeso ? window.fmtPeso(v) : ('₱' + (Number(v) || 0).toFixed(2)));
  const canWrite = (typeof isRealPresident === 'function') ? isRealPresident() : false;

  container.innerHTML = window.skeletonHtml ? window.skeletonHtml('rows') : '<p>Loading…</p>';

  // ── the switch's stored state ──────────────────────────────────────────
  let switchDoc = null, switchReadFailed = false;
  try {
    const d = await db.collection('settings').doc('payrollOfficePolicy').get();
    switchDoc = d.exists ? d.data() : null;
  } catch (_) { switchReadFailed = true; }
  if (!container.isConnected) return;
  // §6.1 whitelist — a corrupted stored value reads as "off" for THIS
  // display purpose only (the real engine THROWS on it instead of guessing —
  // this report is not the place to guess either, so it is shown as its own
  // flag rather than silently treated as either state).
  const storedPolicy = switchDoc && switchDoc.policy;
  const policyUnknown = storedPolicy != null && window.PAY_POLICY_VALUES && window.PAY_POLICY_VALUES.indexOf(storedPolicy) === -1;
  const switchOn = storedPolicy === 'taskbased';

  // ── the minimum-wage floor (§8.2) ───────────────────────────────────────
  let floorDoc = null, floorReadFailed = false;
  try {
    const d = await db.collection('settings').doc('payrollWageFloor').get();
    floorDoc = d.exists ? d.data() : null;
  } catch (_) { floorReadFailed = true; }
  if (!container.isConnected) return;
  const floorMonthly = (floorDoc && Number(floorDoc.monthlyFloor) > 0) ? Number(floorDoc.monthlyFloor) : null;

  // ── the preview — current Manila month, BOTH builds through the real engine ──
  const month = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10)).slice(0, 7);
  const monthLabel = window.fmtMonthLabel ? window.fmtMonthLabel(month) : month;
  let rows = [], previewFailed = false;
  if (typeof window.buildPayRunLines === 'function') {
    try {
      const [nowBuilt, nextBuilt] = await Promise.all([
        window.buildPayRunLines(month, { policy: 'flat' }),
        window.buildPayRunLines(month, { policy: 'taskbased' })
      ]);
      const nextByUid = {};
      (nextBuilt.lines || []).forEach(l => { nextByUid[l.uid] = l; });
      rows = (nowBuilt.lines || []).map(l => {
        const n = nextByUid[l.uid] || l;
        const chk = (floorMonthly != null && typeof window.wageFloorCheck === 'function')
          ? window.wageFloorCheck(n, floorMonthly) : { checked: false, ok: true };
        return {
          uid: l.uid, name: l.name,
          nowPay: l.finalPay, nextPay: n.finalPay,
          perfFactor: n.perfFactor, kpiScore: n.kpiScore, attScore: n.attScore,
          below: chk.checked && !chk.ok
        };
      });
    } catch (_) { previewFailed = true; }
  } else {
    previewFailed = true;
  }
  if (!container.isConnected) return;
  const totalNow  = rows.reduce((s, r) => s + (r.nowPay  || 0), 0);
  const totalNext = rows.reduce((s, r) => s + (r.nextPay || 0), 0);

  const year = (window.bizYear ? window.bizYear() : new Date().getFullYear());
  const tableVerified = ((window.STATUTORY && window.STATUTORY[String(year)]) || {}).verified === true;

  const stateLine = switchOn
    ? `<div class="py-sub" style="margin:6px 0 10px">On since ${esc(switchDoc.changedAtLabel || '—')} — turned on by ${esc(switchDoc.changedByName || '—')}.</div>`
    : `<div class="py-sub" style="margin:6px 0 10px">Off — nothing below has changed anyone's pay yet.</div>`;

  const floorCardHtml = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Minimum wage</h3></div>
      ${floorMonthly != null
        ? `<div class="py-sub" style="margin-bottom:6px">Saved: <strong>${esc(peso(floorMonthly))}</strong> a month. Source: ${esc((floorDoc && floorDoc.source) || '—')}${floorDoc && floorDoc.setAtLabel ? ' · set ' + esc(floorDoc.setAtLabel) + (floorDoc.setByName ? ' by ' + esc(floorDoc.setByName) : '') : ''}.</div>`
        : `<div class="py-sub" style="margin-bottom:6px;color:var(--warning)">Not set — pay is not being checked against a minimum.</div>`}
      ${floorReadFailed ? `<div class="alert-banner" style="cursor:default;margin-bottom:8px"><span>${ico('⚠', 16)} The saved minimum wage could not be read — what is shown may be out of date.</span></div>` : ''}
      ${canWrite ? `
      <div class="form-group">
        <label for="sr-tb-floor">Minimum monthly pay (₱)</label>
        <input id="sr-tb-floor" type="number" step="any" min="0" value="${esc(floorMonthly != null ? floorMonthly : '')}"/>
        <p style="font-size:11px;color:var(--text-muted);margin-top:3px">Enter the minimum monthly pay that applies to your office staff under the current wage order. The app does not know this number — it changes by region and by wage order, so it must come from you or your accountant.</p>
      </div>
      <div class="form-group">
        <label for="sr-tb-floor-source">Where this came from <span style="color:var(--danger)">*</span></label>
        <input id="sr-tb-floor-source" placeholder="e.g. Wage Order No. RB-IV-A-20" value="${esc((floorDoc && floorDoc.source) || '')}"/>
      </div>
      <button class="btn-secondary btn-sm" id="sr-tb-floor-save">${ico('💾', 14)} Save minimum wage</button>
      ` : `<p style="font-size:11px;color:var(--text-muted)">${ico('🔒', 12)} Only the President can set this.</p>`}
    </div>`;

  const totalsHtml = rows.length
    ? `<div class="py-problem"><div class="py-ptext"><strong>Whole month now ${esc(peso(totalNow))} → ${esc(peso(totalNext))}</strong> — ${rows.length} ${rows.length === 1 ? 'person' : 'people'}.</div></div>`
    : '';
  const previewRowsHtml = previewFailed
    ? `<div class="alert-banner" style="cursor:default"><span>${ico('⚠', 16)} The preview could not be built right now — reload before deciding anything from this.</span></div>`
    : (!rows.length
      ? `<div class="py-sub">Nobody is on the Office Team's month yet.</div>`
      : rows.map(r => `
        <div class="py-problem">
          <div class="py-ptext"><strong>${esc(r.name)}</strong> — Pay now ${esc(peso(r.nowPay))} → ${esc(peso(r.nextPay))}
            ${r.below ? `<span class="badge badge-red" style="font-size:10px">Below the saved minimum wage</span>` : ''}<br/>
            <span style="color:var(--text-muted)">${Math.round((r.perfFactor || 0) * 100)}% — task results ${Math.round((r.kpiScore || 0) * 100)}%, on-time check-ins ${Math.round((r.attScore || 0) * 100)}%</span>
          </div>
        </div>`).join(''));

  // Disabled on EITHER failure — a switch read failure means we do not
  // actually know today's state (switchOn above would be a guess), and a
  // preview failure means the confirm dialog would restate numbers nobody
  // can trust. Never let the President flip a switch this screen can't
  // honestly describe right now.
  const toggleDisabled = previewFailed || switchReadFailed;
  const toggleBtnHtml = canWrite
    ? `<button class="btn-primary btn-sm" id="sr-tb-toggle"${toggleDisabled ? ' disabled' : ''}>${switchOn ? 'Go back to fixed pay' : 'Use task-based pay'}</button>${toggleDisabled ? '<p style="font-size:11px;color:var(--text-muted);margin-top:4px">Reload before using this — what is shown above may not be accurate right now.</p>' : ''}`
    : `<span class="badge ${switchOn ? 'badge-green' : 'badge-gray'}" style="font-size:11px">${switchOn ? 'On' : 'Off'}</span>
       <p style="font-size:11px;color:var(--text-muted);margin-top:4px">${ico('🔒', 12)} Only the President can turn this on or off.</p>`;

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Task-based pay — Office Team</h3></div>
      <p style="font-size:13px;line-height:1.5">When this is on, an office person's monthly pay follows their results: take-home pay is worked out as usual (salary plus allowance, minus government deductions and other deductions), then multiplied by a percentage — 70% from task results and 30% from on-time morning check-ins. A check-in counts as on time when the person has timed in and read every notification before 9:00 AM. Government deductions are never reduced — they stay at the full amounts and are paid to the agencies in full. The Operations Team is not affected: their pay follows geo-tracked clock-ins and hours only.</p>
      ${switchReadFailed ? `<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${ico('⚠', 16)} Could not read the pay method setting — what's shown below may not reflect whether task-based pay is actually on or off right now. Reload before deciding anything from this.</span></div>` : ''}
      ${policyUnknown ? `<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${ico('⚠', 16)} The pay method setting holds a value the app does not know ("${esc(storedPolicy)}") — fix it here before relying on this report.</span></div>` : ''}
      ${stateLine}
      ${!tableVerified ? `<p style="font-size:11px;color:var(--text-muted);margin-top:4px">${ico('⚠', 12)} Amounts use this year's placeholder rates, which are not confirmed yet — see the rates form above.</p>` : ''}
    </div>

    ${floorCardHtml}

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Pay for ${esc(monthLabel)} — now vs. task-based</h3></div>
      <div class="card-body" style="padding-top:0">
        ${floorMonthly == null && !previewFailed ? `<div class="py-sub" style="margin-bottom:8px">No minimum wage amount is saved yet — the figures above are not being checked against one.</div>` : ''}
        ${totalsHtml}
        ${previewRowsHtml}
      </div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Switch</h3></div>
      <div class="card-body" style="padding-top:0">
        ${toggleBtnHtml}
        <p style="font-size:11px;color:var(--text-muted);margin-top:10px">Weighting is 70% task results, 30% on-time check-ins — the owner's decision, 2026-08-12. A person who finishes every task but checks in late loses up to about 15% of the month's pay.</p>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  if (canWrite) {
    const floorSaveBtn = container.querySelector('#sr-tb-floor-save');
    if (floorSaveBtn) {
      floorSaveBtn.addEventListener('click', () => window.busy(floorSaveBtn, async () => {
        const amtEl = container.querySelector('#sr-tb-floor');
        const srcEl = container.querySelector('#sr-tb-floor-source');
        const amt = parseFloat(amtEl ? amtEl.value : '');
        const src = (srcEl ? srcEl.value : '').trim();
        if (!Number.isFinite(amt) || amt <= 0) { Notifs.showToast('Enter a minimum monthly pay amount greater than zero.', 'error'); return; }
        if (!src) { Notifs.showToast('Say where this minimum wage came from — it is recorded alongside the amount.', 'error'); return; }
        try {
          await db.collection('settings').doc('payrollWageFloor').set({
            monthlyFloor: amt, source: src,
            setBy: (currentUser && currentUser.uid) || '',
            setByName: (window.userProfile && window.userProfile.displayName) || '',
            setAtLabel: (window.bizDate ? window.bizDate() : ''),
            setAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          window.logAudit && window.logAudit('update', 'settings', 'payrollWageFloor', { monthlyFloor: amt });
          Notifs.success('Minimum wage saved.');
          window.renderTaskBasedPaySection(container, currentUser, currentRole);
        } catch (e) {
          Notifs.showToast('Could not save: ' + (e.message || e.code || e), 'error');
        }
      }));
    }

    const toggleBtn = container.querySelector('#sr-tb-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => window.busy(toggleBtn, async () => {
        const turningOn = !switchOn;
        const nextPolicy = turningOn ? 'taskbased' : 'flat';
        const msg = turningOn
          ? `Office pay for ${monthLabel} would go from ${peso(totalNow)} to ${peso(totalNext)} for ${rows.length} people. This takes effect the next time a month's figures are worked out — months already paid are not touched. Turn it on?`
          : `Office pay for ${monthLabel} would go from ${peso(totalNext)} back to ${peso(totalNow)} for ${rows.length} people. This takes effect the next time a month's figures are worked out — months already paid are not touched. Turn it off?`;
        if (!(await window.confirmDialog({ message: msg, confirmLabel: turningOn ? 'Use task-based pay' : 'Go back to fixed pay', cancelLabel: 'Cancel' }))) return;
        try {
          await db.collection('settings').doc('payrollOfficePolicy').set({
            policy: nextPolicy,
            changedBy: (currentUser && currentUser.uid) || '',
            changedByName: (window.userProfile && window.userProfile.displayName) || '',
            changedAtLabel: (window.bizDate ? window.bizDate() : ''),
            changedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          window.logAudit && window.logAudit('update', 'settings', 'payrollOfficePolicy', { policy: nextPolicy });
          Notifs.success(turningOn ? 'Task-based pay is on for the Office Team.' : 'Office Team pay is back to fixed.');
          window.renderTaskBasedPaySection(container, currentUser, currentRole);
        } catch (e) {
          Notifs.showToast('Could not save: ' + (e.message || e.code || e), 'error');
        }
      }));
    }
  }
};
