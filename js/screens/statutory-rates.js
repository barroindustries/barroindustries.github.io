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
