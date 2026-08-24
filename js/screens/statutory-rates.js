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
    <div id="sr-officesplit-section" style="margin-top:18px"></div>
    <div id="sr-legalbasis-section" style="margin-top:18px"></div>
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

  // OFFICE-SPLIT-SPEC-2026-08-14 — "base and incentive": beside the
  // task-based pay controls per the owner's placement instruction (same
  // reasoning as the legal-basis section below — independent of everything
  // else on this screen, so it repaints itself without touching any other
  // section's reads/writes).
  const officeSplitHost = c.querySelector('#sr-officesplit-section');
  if (officeSplitHost) window.renderOfficeSplitSection(officeSplitHost, currentUser, currentRole);

  // PAY-EXPLANATION-SPEC-2026-08-13 §"cite a law" — the citation editor, right
  // beside the task-based pay controls it explains, per the owner's placement
  // instruction. Independent of both sections above (reads/writes its own
  // settings doc), so it repaints itself without touching either.
  const legalBasisHost = c.querySelector('#sr-legalbasis-section');
  if (legalBasisHost) window.renderPayLegalBasisSection(legalBasisHost, currentUser, currentRole);

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
   TASK-BASED-PAY-SPEC-2026-08-12 §7 — Office Team pay method: the
   explanation, the minimum-wage floor, the two-build preview, and the
   President-gated picker.

   OFFICE-KPI-PAY-SPEC-2026-08-25 §1.2 — the picker now offers exactly two
   choices going forward: 'flat' and 'basekpi' (₱10,000 base paid in full,
   the remainder multiplied by the month's KPI score alone — attendance is
   NOT read by this branch, see money-core.js's 'basekpi' arm). 'taskbased'
   (net × 0.7·KPI + 0.3·on-time check-ins) is SUPERSEDED as of 2026-08-25 —
   it stays in window.PAY_POLICY_VALUES (never remove a value a stored
   settings doc might hold) and is shown honestly if that is what is
   currently stored, but it is not offered for new activation.

   Nothing here writes payroll directly — the only writes in this whole
   section are settings/payrollOfficePolicy (the picker) and
   settings/payrollWageFloor (the floor), both already President-write /
   staff-read under the existing settings/{docId} rule (zero rules changes).
   Every peso below is built through window.buildPayRunLines with an EXPLICIT
   policy argument — which bypasses the settings rung (§6.2) — so this is a
   preview regardless of the stored value, and it can never show a number
   the real engine wouldn't (never a second copy of the math).
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
  // OFFICE-KPI-PAY-SPEC-2026-08-25 §1.2 — three display states now, not a
  // binary switch: the two policies the picker actually offers going
  // forward (isFlat/isBaseKpi), plus the superseded 'taskbased' value shown
  // honestly if that is what is stored (isSuperseded) — never crash on it,
  // never offer it as a fresh choice.
  const isBaseKpi = storedPolicy === 'basekpi';
  const isSuperseded = storedPolicy === 'taskbased';
  const isFlat = !isBaseKpi && !isSuperseded;
  const activePolicyLabel = isBaseKpi ? 'Base + KPI incentive' : (isSuperseded ? 'Task-based (superseded)' : 'Flat');

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
      // OFFICE-KPI-PAY-SPEC-2026-08-25 §1.2 — the preview is always Flat vs.
      // Base + KPI incentive, the two choices the picker actually offers,
      // regardless of which policy is currently stored (same as before,
      // when this always previewed Flat vs. Task-based regardless of switch
      // state) — never a second copy of who's on payroll or how their KPI
      // is worked out.
      const [nowBuilt, nextBuilt] = await Promise.all([
        window.buildPayRunLines(month, { policy: 'flat' }),
        window.buildPayRunLines(month, { policy: 'basekpi' })
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
          // basekpi-only fields (§1.1) — attendance is never part of this
          // branch's math, so it is never read here either.
          kpiFactor: n.kpiFactor, incentiveFull: n.incentiveFull, incentiveEarned: n.incentiveEarned,
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

  const stateLine = isBaseKpi
    ? `<div class="py-sub" style="margin:6px 0 10px">Base + KPI incentive is on, since ${esc(switchDoc.changedAtLabel || '—')} — turned on by ${esc(switchDoc.changedByName || '—')}.</div>`
    : isSuperseded
      ? `<div class="py-sub" style="margin:6px 0 10px">Still on the superseded Task-based policy, since ${esc(switchDoc.changedAtLabel || '—')} — turned on by ${esc(switchDoc.changedByName || '—')}. Switch to Base + KPI incentive below.</div>`
      : `<div class="py-sub" style="margin:6px 0 10px">Flat — nothing below has changed anyone's pay yet.</div>`;
  const supersededBannerHtml = isSuperseded
    ? `<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${ico('⚠', 16)} Office pay is currently set to Task-based pay, which is superseded (2026-08-25) — switch to Base + KPI incentive below.</span></div>`
    : '';

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
            <span style="color:var(--text-muted)">KPI ${Math.round((r.kpiFactor || 0) * 100)}% — under Base + KPI incentive: incentive ${esc(peso(r.incentiveEarned))} of ${esc(peso(r.incentiveFull))} possible</span>
          </div>
        </div>`).join(''));

  // Disabled on EITHER failure — a switch read failure means we do not
  // actually know today's state (isBaseKpi/isSuperseded/isFlat above would
  // be a guess), and a preview failure means the confirm dialog would
  // restate numbers nobody can trust. Never let the President change the
  // pay method this screen can't honestly describe right now.
  const pickersDisabled = previewFailed || switchReadFailed;
  const pickerHtml = canWrite
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
         <button class="btn-${isFlat ? 'primary' : 'secondary'} btn-sm" id="sr-tb-pick-flat"${pickersDisabled || isFlat ? ' disabled' : ''}>Flat — full package regardless of performance</button>
         <button class="btn-${isBaseKpi ? 'primary' : 'secondary'} btn-sm" id="sr-tb-pick-basekpi"${pickersDisabled || isBaseKpi ? ' disabled' : ''}>Base + KPI incentive — ₱ base paid in full, the rest multiplied by the month's KPI</button>
       </div>
       ${pickersDisabled ? '<p style="font-size:11px;color:var(--text-muted);margin-top:4px">Reload before using this — what is shown above may not be accurate right now.</p>' : ''}`
    : `<span class="badge ${isBaseKpi ? 'badge-green' : (isSuperseded ? 'badge-red' : 'badge-gray')}" style="font-size:11px">${esc(activePolicyLabel)}</span>
       <p style="font-size:11px;color:var(--text-muted);margin-top:4px">${ico('🔒', 12)} Only the President can change this.</p>`;

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Office pay method</h3></div>
      <p style="font-size:13px;line-height:1.5">Two ways to pay the Office Team. <strong>Flat</strong> pays each person's full package every month regardless of performance. <strong>Base + KPI incentive</strong> protects a ₱10,000 base — paid in full, never reduced — and multiplies only the remainder of the package by that month's KPI score (70% task results, 30% deliverables). Government deductions are never reduced under either method — they stay at the full amounts and are paid to the agencies in full. Attendance does not affect office pay. The Operations Team is not affected: their pay follows geo-tracked clock-ins and hours only.</p>
      ${supersededBannerHtml}
      ${switchReadFailed ? `<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${ico('⚠', 16)} Could not read the pay method setting — what's shown below may not reflect what's actually on right now. Reload before deciding anything from this.</span></div>` : ''}
      ${policyUnknown ? `<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${ico('⚠', 16)} The pay method setting holds a value the app does not know ("${esc(storedPolicy)}") — fix it here before relying on this report.</span></div>` : ''}
      ${stateLine}
      ${!tableVerified ? `<p style="font-size:11px;color:var(--text-muted);margin-top:4px">${ico('⚠', 12)} Amounts use this year's placeholder rates, which are not confirmed yet — see the rates form above.</p>` : ''}
    </div>

    ${floorCardHtml}

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Pay for ${esc(monthLabel)} — Flat vs. Base + KPI incentive</h3></div>
      <div class="card-body" style="padding-top:0">
        ${floorMonthly == null && !previewFailed ? `<div class="py-sub" style="margin-bottom:8px">No minimum wage amount is saved yet — the figures above are not being checked against one.</div>` : ''}
        ${totalsHtml}
        ${previewRowsHtml}
      </div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Pay method</h3></div>
      <div class="card-body" style="padding-top:0">
        ${pickerHtml}
        <p style="font-size:11px;color:var(--text-muted);margin-top:10px">Base + KPI incentive: KPI is 70% task results, 30% deliverables score. The ₱10,000 base is never at risk — only the incentive above it moves with KPI, and attendance never affects it.</p>
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

    // OFFICE-KPI-PAY-SPEC-2026-08-25 §1.2 — two picker buttons, not one
    // toggle: from Flat you can only go to Base + KPI incentive, from Base +
    // KPI incentive you can only go back to Flat, and from the superseded
    // Task-based value (isSuperseded) either button is offered — there is no
    // path that writes 'taskbased' again.
    const bindPolicyPick = (id, targetPolicy, targetLabel) => {
      const btn = container.querySelector(id);
      if (!btn) return;
      btn.addEventListener('click', () => window.busy(btn, async () => {
        const toPay = targetPolicy === 'basekpi' ? totalNext : totalNow;
        const msg = `Office pay for ${monthLabel} would be worked out as ${targetLabel} the next time a month's figures are run — ${peso(toPay)} for ${rows.length} people on today's figures. This takes effect the next time a month's figures are worked out — months already paid are not touched. Switch to ${targetLabel}?`;
        if (!(await window.confirmDialog({ message: msg, confirmLabel: `Use ${targetLabel}`, cancelLabel: 'Cancel' }))) return;
        try {
          await db.collection('settings').doc('payrollOfficePolicy').set({
            policy: targetPolicy,
            changedBy: (currentUser && currentUser.uid) || '',
            changedByName: (window.userProfile && window.userProfile.displayName) || '',
            changedAtLabel: (window.bizDate ? window.bizDate() : ''),
            changedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          window.logAudit && window.logAudit('update', 'settings', 'payrollOfficePolicy', { policy: targetPolicy });
          Notifs.success(`Office pay switched to ${targetLabel}.`);
          window.renderTaskBasedPaySection(container, currentUser, currentRole);
        } catch (e) {
          Notifs.showToast('Could not save: ' + (e.message || e.code || e), 'error');
        }
      }));
    };
    bindPolicyPick('#sr-tb-pick-flat', 'flat', 'Flat');
    bindPolicyPick('#sr-tb-pick-basekpi', 'basekpi', 'Base + KPI incentive');
  }
};

/* ═══════════════════════════════════════════════════════════════════════
   PAY-EXPLANATION-SPEC-2026-08-13 — "cite a law". The owner asked for a
   legal citation behind the Office Team's task-based pay explanation and
   the Operations Team's hours/overtime explanation shown on My Finance
   (js/screens/dashboards.js's renderPersonalFinance).

   ⚠ THIS FILE INVENTS NO LAW. No Philippine statute, article number, DOLE
   issuance or case is written anywhere in this app's code — see
   js/pay-policy.js's payLegalBasisLine header for the full reasoning. This
   screen only stores and displays back exactly what a human typed here.

   Stored PER TEAM, not one citation for both: settings/payrollLegalBasis =
   { office: {citation, source, enteredBy, enteredByName, enteredAtLabel,
   enteredAt}, ops: {...same shape} }. The Office Team's task-based-pay basis
   and the Operations Team's hours/overtime basis are not necessarily the
   same law — collapsing them into one field would be this app asserting an
   equivalence it has no authority to assert. (If the owner later decides one
   citation genuinely covers both teams, he can type the same text into both
   fields — the storage shape does not force two DIFFERENT citations, only
   keeps them independently editable.)

   PRESIDENT-ONLY WRITE (settings/{docId} in firestore.rules — same rule
   payrollWageFloor and payrollOfficePolicy already use; no rules change
   needed). Staff-read, same as every other settings doc.

   FREE TEXT FROM AN ADMIN, READ BY EVERY EMPLOYEE — an XSS sink. Every
   render of citation/source below runs through esc().
   ═══════════════════════════════════════════════════════════════════════ */
window.renderPayLegalBasisSection = async function (container, currentUser, currentRole) {
  if (!container) return;
  const esc = (v) => (window.escHtml ? window.escHtml(v == null ? '' : v) : String(v == null ? '' : v));
  const ico = (g, s) => (window.emojiIcon ? window.emojiIcon(g, s || 16) : '');
  const canWrite = (typeof isRealPresident === 'function') ? isRealPresident() : false;

  container.innerHTML = window.skeletonHtml ? window.skeletonHtml('rows') : '<p>Loading…</p>';

  let doc = null, readFailed = false;
  try {
    const d = await db.collection('settings').doc('payrollLegalBasis').get();
    doc = d.exists ? d.data() : null;
  } catch (_) { readFailed = true; }
  if (!container.isConnected) return;

  const TEAMS = [
    { key: 'office', label: 'Office Team', sub: 'Task-based pay — this is the basis shown on My Finance for anyone on the Office Team.' },
    { key: 'ops',    label: 'Operations Team', sub: 'Hours, overtime and travel pay — this is the basis shown on My Finance for anyone on the Operations Team.' }
  ];

  const teamCard = (t) => {
    const entry = (doc && doc[t.key]) || {};
    const hasCitation = !!(entry.citation && String(entry.citation).trim());
    return `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>${esc(t.label)}</h3></div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${esc(t.sub)}</p>
      ${hasCitation
        ? `<div class="alert-banner" style="cursor:default;background:rgba(47,158,68,.10);border-color:var(--success);margin-bottom:10px">
             <span>${ico('✅', 16)} <strong>Citation on file.</strong> Entered by ${esc(entry.enteredByName || entry.enteredBy || '—')}${entry.enteredAtLabel ? ' on ' + esc(entry.enteredAtLabel) : ''}.</span>
           </div>`
        : `<div class="alert-banner" style="cursor:default;margin-bottom:10px">
             <span>${ico('⚠', 16)} Nothing entered yet. Until this is filled in, My Finance explains the pay model in plain language only — no law is cited.</span>
           </div>`}
      ${canWrite ? `
      <div class="form-group">
        <label for="sr-lb-${t.key}-cite">Legal basis <span style="color:var(--danger)">*</span></label>
        <textarea id="sr-lb-${t.key}-cite" rows="2" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);resize:vertical" placeholder="e.g. the specific article, section or issuance you are relying on">${esc(entry.citation || '')}</textarea>
      </div>
      <div class="form-group">
        <label for="sr-lb-${t.key}-src">Source</label>
        <input id="sr-lb-${t.key}-src" placeholder="e.g. where this reading came from — counsel, an issuance, a circular" value="${esc(entry.source || '')}"/>
      </div>
      <label class="check-row"><input type="checkbox" id="sr-lb-${t.key}-attest"/><span>I confirm this is accurate and is Barro Industries' stated legal basis for the ${esc(t.label)}'s pay model.</span></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn-secondary btn-sm" id="sr-lb-${t.key}-save">${ico('💾', 14)} Save</button>
        ${hasCitation ? `<button class="btn-secondary btn-sm" id="sr-lb-${t.key}-clear" style="color:var(--danger)">${ico('🗑️', 14)} Clear</button>` : ''}
      </div>` : ''}
    </div>`;
  };

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Legal basis for pay — My Finance</h3></div>
      <p style="font-size:13px;line-height:1.5">The pay-model explanation each employee sees on their own My Finance page can cite the specific law it is based on. Nothing is ever invented here or anywhere in this app — until you enter a citation for a team below, the explanation shown to that team stays in plain language with no legal claim.</p>
      ${readFailed ? `<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${ico('⚠', 16)} The saved citations could not be read — what is shown below may be out of date. Reload before relying on this.</span></div>` : ''}
      ${!canWrite ? `<div class="alert-banner" style="cursor:default"><span>${ico('🔒', 16)} Only the President can enter or change a legal citation — this becomes the employer's stated position to staff. You can read it here.</span></div>` : ''}
    </div>
    ${TEAMS.map(teamCard).join('')}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  if (!canWrite) return;

  TEAMS.forEach((t) => {
    const saveBtn = container.querySelector(`#sr-lb-${t.key}-save`);
    if (saveBtn) {
      saveBtn.addEventListener('click', () => window.busy(saveBtn, async () => {
        const citeEl = container.querySelector(`#sr-lb-${t.key}-cite`);
        const srcEl  = container.querySelector(`#sr-lb-${t.key}-src`);
        const attestEl = container.querySelector(`#sr-lb-${t.key}-attest`);
        const citation = (citeEl ? citeEl.value : '').trim();
        const source   = (srcEl ? srcEl.value : '').trim();
        if (!citation) { Notifs.showToast('Enter the legal basis before saving.', 'error'); return; }
        if (!attestEl || !attestEl.checked) { Notifs.showToast('Tick the confirmation before this is shown to staff as a legal basis.', 'error'); return; }
        try {
          const patch = {};
          patch[t.key] = {
            citation, source,
            enteredBy: (currentUser && currentUser.uid) || '',
            enteredByName: (window.userProfile && window.userProfile.displayName) || '',
            enteredAtLabel: (window.bizDate ? window.bizDate() : ''),
            enteredAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          await db.collection('settings').doc('payrollLegalBasis').set(patch, { merge: true });
          window.logAudit && window.logAudit('update', 'settings', 'payrollLegalBasis', { team: t.key });
          Notifs.success(`Legal basis saved for the ${t.label}.`);
          window.renderPayLegalBasisSection(container, currentUser, currentRole);
        } catch (e) {
          Notifs.showToast('Could not save: ' + (e.message || e.code || e), 'error');
        }
      }));
    }
    const clearBtn = container.querySelector(`#sr-lb-${t.key}-clear`);
    if (clearBtn) {
      clearBtn.addEventListener('click', () => window.busy(clearBtn, async () => {
        if (!(await window.confirmDialog({ message: `Remove the saved legal citation for the ${t.label}? Their My Finance explanation goes back to plain language only.`, danger: true }))) return;
        try {
          const patch = {};
          patch[t.key] = firebase.firestore.FieldValue.delete();
          await db.collection('settings').doc('payrollLegalBasis').set(patch, { merge: true });
          window.logAudit && window.logAudit('update', 'settings', 'payrollLegalBasis', { team: t.key, cleared: true });
          Notifs.success(`Legal citation cleared for the ${t.label}.`);
          window.renderPayLegalBasisSection(container, currentUser, currentRole);
        } catch (e) {
          Notifs.showToast('Could not clear: ' + (e.message || e.code || e), 'error');
        }
      }));
    }
  });
};

/* ═══════════════════════════════════════════════════════════════════════
   OFFICE-SPLIT-SPEC-2026-08-14 — "Base and incentive": restructure Office
   Team pay into a protected base plus a performance-linked incentive.

   THE OWNER'S DECISION (2026-08-14, verbatim): "ok lets do 10k base for
   everyone" … "fix it, the excess of 10k is incentive subject to kpi and
   attendance". For each Office Team person: base = ₱10,000 (configurable
   below), incentive = current package − base, and only the incentive is
   scaled by performance. Nobody's total package changes today — what
   changes is which part of it is at risk, and only once the owner
   separately turns performance-based pay on (he has not; see below).

   WHY THIS SHAPE. Reducing a person's STATED SALARY for performance is a
   deduction from wages. Paying an INCENTIVE that was not fully earned is
   not. Same money, different legal footing — so the split has to happen
   before any scaling, not be simulated after the fact. js/money-core.js's
   `computePayLine` already has exactly this shape under policy:'performance'
   — `base − statutory − otherDeductions + allowance×perfFactor`, with a
   standing comment there that "BASE WAGE is never docked (PH labor-safe)".
   This section calls that frozen function directly (never a second copy of
   the arithmetic) with an EXPLICIT policy argument, so every preview number
   below is guaranteed identical to what the real engine would produce.

   THE FIELD DECISION. The incentive is carried in the EXISTING `allowance`
   field on payroll/{uid} — 'performance' already scales exactly that field,
   it is tested and pinned, and it needs NO change to money-core.js. Every
   Office person's allowance is ₱0 today (the roster's Allowances column
   doesn't render it), so Apply below overwrites nothing that was already
   there.
   ⚠ FLAG: a genuine allowance added later (transport, meal, etc.) would
   land in this SAME field and would therefore ALSO be scaled by
   performance once that policy is ever turned on. If the owner needs a
   non-scaling allowance alongside the incentive, that needs its own field —
   a separate build, not this one.

   NOTHING IS ACTIVATED BY THIS SCREEN. Apply below writes only `salary` and
   `allowance` on payroll/{uid} — never settings/payrollOfficePolicy. Under
   the 'flat' policy every payroll run still uses today (base+allowance,
   unscaled), the split is a no-op in pesos: 10,000 + 4,500 pays exactly what
   14,500 + 0 paid.

   ⚠ UPDATED 2026-08-14 — the note that used to sit here said 'performance'
   was not a legal settings value, so applying the split could never change a
   real run. That WAS true and it made the whole feature inert: the owner
   would have restructured every pay record and seen not one peso move.
   window.PAY_POLICY_VALUES now carries 'performance' (js/pay-policy.js,
   pinned by tests/taskbased-pay.test.mjs), and the switch below stores it.
   Applying the split still changes nothing on its own — the switch is a
   separate, deliberate second action, exactly as with task-based pay.

   IDEMPOTENT + REVERSIBLE. payroll/{uid}.officeSplit.originalSalary/
   originalAllowance are captured ONCE, on the first Apply, and never
   overwritten by a later Apply — so applying twice reproduces the same
   ₱10,000 + ₱4,500 instead of compounding into ₱10,000 + ₱0 (package =
   salary+allowance is itself a fixed point of the split, but the recorded
   original is what makes a genuine UNDO possible — see the Undo button,
   which restores originalSalary/originalAllowance and clears the flag).

   GUARDS.
     • Operations Team excluded entirely — this section's roster comes from
       window.buildPayRunLines, whose own skip list already removes anyone
       with payClass === 'production' (js/departments.js's
       monthlyRunSkipReason) before a single line is built.
     • Package at or below the base -> base = package, incentive = 0 (never
       negative) — Math.min/Math.max below.
     • No salary on file -> named, not defaulted to ₱10,000. Checked on the
       raw payroll/{uid} doc, not on the derived package.
     • A proposed base below the stored minimum wage (settings/
       payrollWageFloor) is flagged per person; absent a stored floor, the
       screen says so rather than implying the base is safe (reuses
       window.wageFloorCheck, same as the task-based section above).

   PRESIDENT-GATED. canSee = isMoneyPriv() (same tier that can see the
   task-based section above — a Finance user can read this, an ordinary
   employee sees nothing). canWrite = isRealPresident() for both Apply and
   Undo — this rewrites real people's pay records. payroll/{uid} is already
   isMoneyAdmin() (president/manager/finance) for create/update in
   firestore.rules; isRealPresident() is a strict subset, so no rules change
   is needed and none is made here.
   ═══════════════════════════════════════════════════════════════════════ */
window.OFFICE_SPLIT_DEFAULT_BASE = 10000; // the owner's number, 2026-08-14 — editable in the UI, never hand-edited elsewhere

window.renderOfficeSplitSection = async function (container, currentUser, currentRole) {
  if (!container) return;
  const canSee = (typeof window.isMoneyPriv === 'function') ? window.isMoneyPriv() : false;
  if (!canSee) { container.innerHTML = ''; return; }

  const esc = (v) => (window.escHtml ? window.escHtml(v == null ? '' : v) : String(v == null ? '' : v));
  const ico = (g, s) => (window.emojiIcon ? window.emojiIcon(g, s || 16) : '');
  const peso = (v) => (window.fmtPeso ? window.fmtPeso(v) : ('₱' + (Number(v) || 0).toFixed(2)));
  const canWrite = (typeof isRealPresident === 'function') ? isRealPresident() : false;

  container.innerHTML = window.skeletonHtml ? window.skeletonHtml('rows') : '<p>Loading…</p>';

  const month = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10)).slice(0, 7);
  const monthLabel = window.fmtMonthLabel ? window.fmtMonthLabel(month) : month;

  // ── the roster + this month's real KPI/attendance/cash-advance figures,
  // through the SAME builder every other pay screen uses (never a second
  // copy of who's on payroll or how their score is worked out) ───────────
  let flatBuilt = null, previewFailed = false;
  try { flatBuilt = await window.buildPayRunLines(month, { policy: 'flat' }); }
  catch (_) { previewFailed = true; }
  if (!container.isConnected) return;

  let usersRes = null, rosterFailed = false;
  try { usersRes = await window.fetchUsersWithPayroll(); }
  catch (_) { rosterFailed = true; }
  if (!container.isConnected) return;
  const payrollDenied = !!(usersRes && usersRes.payrollDenied);

  let statusRule = { on: false }, statusReadFailed = false;
  try { statusRule = await window.statutoryStatusRuleOn(); }
  catch (_) { statusReadFailed = true; }
  if (!container.isConnected) return;

  let floorDoc = null, floorReadFailed = false;
  try {
    const d = await db.collection('settings').doc('payrollWageFloor').get();
    floorDoc = d.exists ? d.data() : null;
  } catch (_) { floorReadFailed = true; }
  if (!container.isConnected) return;
  const floorMonthly = (floorDoc && Number(floorDoc.monthlyFloor) > 0) ? Number(floorDoc.monthlyFloor) : null;

  // Is the incentive actually being paid on KPI right now? Read the SAME
  // settings doc buildPayRunLines reads, so this section can never claim a
  // state the pay run disagrees with. A failed read is reported as unknown
  // rather than assumed off — telling somebody the incentive is not scaling
  // when it is would be the worse of the two errors.
  // OFFICE-KPI-PAY-SPEC-2026-08-25 — 'basekpi' is the live scaling policy
  // going forward (base paid in full, remainder × KPI, attendance never
  // read). 'performance' (KPI 70% / attendance 30%, OFFICE-SPLIT-SPEC
  // 2026-08-14) is kept recognised as the HISTORIC on-state, since a stored
  // settings doc can still hold it — shown honestly below with its own
  // "switch to Base + KPI incentive" affordance rather than silently folded
  // into either "on" or "off".
  let splitPolicyOn = false, splitPolicyLegacy = false, policyReadFailed = false;
  try {
    const pd = await db.collection('settings').doc('payrollOfficePolicy').get();
    const p = (pd.exists && pd.data()) ? pd.data().policy : null;
    splitPolicyOn = p === 'basekpi';
    splitPolicyLegacy = p === 'performance';
  } catch (_) { policyReadFailed = true; }
  if (!container.isConnected) return;

  const hardFail = previewFailed || rosterFailed || payrollDenied;

  // ── Office roster: non-partner, not removed, not Operations Team ───────
  // window.isExternalPartnerUser is the SAME predicate buildPayRunLines
  // itself uses to keep external partners off payroll entirely (js/config.js).
  const officeRaw = hardFail ? [] : usersRes.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(u => !window.isExternalPartnerUser(u) && u.removed !== true && u.payClass !== 'production');

  const flatByUid = {};
  (flatBuilt && flatBuilt.lines ? flatBuilt.lines : []).forEach(l => { flatByUid[l.uid] = l; });

  // People on the Office roster but NOT on this month's payable list —
  // named with their real reason (buildPayRunLines' own skip list), not
  // silently dropped. payClass==='production' never appears here (already
  // filtered out of officeRaw above), so this is purely the period-scoped
  // and worker-profile-linked cases.
  const officeIds = new Set(officeRaw.map(u => u.id));
  const otherSkipped = (flatBuilt && flatBuilt.skipped ? flatBuilt.skipped : [])
    .filter(s => officeIds.has(s.uid));

  const alreadySplit = officeRaw.filter(u => u.officeSplit && u.officeSplit.active === true);

  // ── pure preview math — kpiScore/caPlan/caBalance are ALREADY resolved
  // for real by the 'flat' build above; only the base/incentive split and
  // the 'basekpi' call are done here, per person, per the currently-typed
  // base amount. Never touches Firestore.
  // OFFICE-KPI-PAY-SPEC-2026-08-25 — the preview policy is 'basekpi', not
  // 'performance': base paid in full, remainder × this month's KPI alone,
  // attendance never read by that branch (money-core.js §1.1). Keeping this
  // preview on the old 'performance' policy would silently blend attendance
  // back into a number this section's own copy now says is KPI-only. ───────
  function computeRows(baseAmount) {
    const rows = [], noSalary = [];
    officeRaw.forEach((u) => {
      const flatLine = flatByUid[u.id];
      if (!flatLine) return; // counted in otherSkipped above
      if (!(Number(u.salary) > 0)) { noSalary.push(u.displayName || u.email || u.id); return; }

      const pkg = +(((flatLine.base || 0) + (flatLine.allowance || 0))).toFixed(2);
      const proposedBase = Math.min(Math.max(0, baseAmount), pkg);
      const proposedIncentive = Math.max(0, +(pkg - proposedBase).toFixed(2));

      // Same statConfig resolution buildPayRunLines applies before calling
      // computePayLine (STATUTORY-BY-STATUS-SPEC) — the split changes the
      // salary/allowance MIX, not the person's employment status, so this
      // has to be replicated for the preview's statutory figure to be
      // trustworthy rather than guessed.
      const plan = window.statutoryStatusPlan(u, statusRule.on, { engine: 'month' });
      const empForPay = plan.active ? { ...u, statConfig: plan.statConfig } : u;
      const synth = { ...empForPay, salary: proposedBase, allowance: proposedIncentive };

      let proposedLine;
      try {
        proposedLine = window.computePayLine(synth, {
          month, policy: 'basekpi',
          kpiScore: flatLine.kpiScore, attScore: flatLine.attScore,
          caPlan: flatLine.caPlan, caBalance: flatLine.caBalance
        });
      } catch (_) { return; } // 'basekpi' never throws for a non-production person — defensive only

      const floorChk = window.wageFloorCheck
        ? window.wageFloorCheck({ effectiveGross: proposedBase }, floorMonthly)
        : { checked: false, ok: true };

      rows.push({
        uid: u.id, name: flatLine.name || u.displayName || u.email || u.id,
        package: pkg, proposedBase, proposedIncentive,
        kpiScore: flatLine.kpiScore, kpiFactor: proposedLine.kpiFactor,
        incentiveFull: proposedLine.incentiveFull, incentiveEarned: proposedLine.incentiveEarned,
        nowPay: flatLine.finalPay, proposedPay: proposedLine.finalPay,
        belowFloor: floorChk.checked && !floorChk.ok,
        alreadySplit: !!(u.officeSplit && u.officeSplit.active === true)
      });
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return { rows, noSalary };
  }

  const stateHtml = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Base and incentive — Office Team</h3></div>
      <p style="font-size:13px;line-height:1.5">Splits each Office Team person's pay into a protected base and a KPI-linked incentive. The base is never reduced for performance — it is a wage, the same as today. The incentive is the rest of their current package; it is only scaled by this month's KPI score once Base + KPI incentive pay is separately turned on. Attendance does not affect pay. Nobody's total package changes by applying this. The Operations Team is not shown here — their pay follows geo-tracked hours only, with no KPI to link an incentive to.</p>
      ${hardFail ? `<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${ico('⚠', 16)} ${payrollDenied ? 'Office pay figures: not shown to you.' : 'This month’s figures could not be read right now.'} Reload before deciding anything from this.</span></div>` : ''}
      ${statusReadFailed ? `<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${ico('⚠', 16)} Could not read the employment-status payroll setting — the figures below may not reflect it. Reload before relying on this.</span></div>` : ''}
      ${floorReadFailed ? `<div class="alert-banner" style="cursor:default;margin-bottom:10px"><span>${ico('⚠', 16)} The saved minimum wage could not be read — the floor check below may be out of date.</span></div>` : ''}
      ${!hardFail && floorMonthly == null ? `<p style="font-size:11px;color:var(--text-muted)">${ico('⚠', 12)} No minimum wage amount is saved (see the task-based pay section above) — proposed base amounts below are not being checked against one.</p>` : ''}
    </div>

    ${canWrite ? `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Base amount</h3></div>
      <div class="form-group">
        <label for="os-base">Protected base (₱ per month)</label>
        <input id="os-base" type="number" step="any" min="0" value="${esc(window.OFFICE_SPLIT_DEFAULT_BASE)}"${hardFail ? ' disabled' : ''}/>
        <p style="font-size:11px;color:var(--text-muted);margin-top:3px">Defaults to ₱10,000, the owner's figure — change it and the preview below updates. Nobody is affected until Apply is pressed below.</p>
      </div>
    </div>` : ''}

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Preview for ${esc(monthLabel)}</h3></div>
      <div class="card-body" style="padding-top:0" id="os-preview-body"></div>
    </div>

    ${canWrite && !hardFail ? `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Apply</h3></div>
      <div class="card-body" style="padding-top:0">
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Writes each person's protected base and incentive to their pay record. Their total package stays the same today — this only changes which part is at risk once Base + KPI incentive pay is turned on. Each person is applied one at a time; if one fails, the rest are still applied and the failure is named below, nothing is left half-done.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn-primary btn-sm" id="os-apply">${ico('✅', 14)} Apply the split</button>
          ${alreadySplit.length ? `<button class="btn-secondary btn-sm" id="os-undo" style="color:var(--danger)">${ico('↩️', 14)} Undo (${alreadySplit.length})</button>` : ''}
        </div>
        ${/* THE SECOND, SEPARATE ACTION. Applying the split moves nothing on
             its own — under 'flat' a base of 10,000 plus an incentive of
             4,500 pays exactly what 14,500 paid. This is the switch that
             makes the incentive actually scale with KPI (attendance never
             affects it, OFFICE-KPI-PAY-SPEC-2026-08-25), and it is
             deliberately its own decision with its own confirmation, the
             same shape as the pay-method picker above. */''}
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
          <div style="font-size:12px;font-weight:700;margin-bottom:4px">Pay the incentive on KPI</div>
          ${splitPolicyLegacy ? `<div class="alert-banner" style="cursor:default;margin-bottom:8px"><span>${ico('⚠', 16)} Still on the superseded 'performance' policy — the incentive is scaling by KPI 70% / attendance 30% the old way. Switch to Base + KPI incentive to drop attendance from pay.</span></div>` : ''}
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
            ${splitPolicyOn
              ? 'On. Each person\'s protected base is paid in full; the remainder is multiplied by this month\'s KPI score. Attendance does not affect pay. Turning this off pays every package in full again.'
              : 'Off. Everyone is paid their full package regardless of KPI. Turning this on pays the base in full and scales only the incentive by KPI — it does not touch anybody\'s base wage, and attendance never affects it.'}
          </p>
          <button class="btn-${splitPolicyOn ? 'secondary' : 'primary'} btn-sm" id="os-policy">
            ${splitPolicyOn ? 'Stop paying the incentive on KPI' : (splitPolicyLegacy ? 'Switch to Base + KPI incentive' : 'Pay the incentive on KPI')}
          </button>
          ${floorMonthly == null ? `<div style="font-size:11px;color:var(--danger);margin-top:8px">No minimum wage amount is saved yet, so nothing is checking these figures against one. Save it above first.</div>` : ''}
        </div>
        <div id="os-result" style="margin-top:10px"></div>
      </div>
    </div>` : (!canWrite ? `<div class="card" style="margin-bottom:12px"><div class="card-body"><p style="font-size:11px;color:var(--text-muted)">${ico('🔒', 12)} Only the President can apply or undo this — it rewrites real pay records.</p></div></div>` : '')}
  `;

  container.innerHTML = stateHtml;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  if (hardFail) return;

  const previewBody = container.querySelector('#os-preview-body');
  const baseInput = container.querySelector('#os-base');

  const rowHtml = (r) => `
    <div class="py-problem">
      <div class="py-ptext"><strong>${esc(r.name)}</strong> — package ${esc(peso(r.package))}${r.alreadySplit ? ` <span class="badge badge-green" style="font-size:10px">Already applied</span>` : ''}${r.belowFloor ? ` <span class="badge badge-red" style="font-size:10px">Base below the saved minimum wage</span>` : ''}<br/>
        Base ${esc(peso(r.proposedBase))} + incentive ${esc(peso(r.proposedIncentive))}<br/>
        <span style="color:var(--text-muted)">KPI ${Math.round((r.kpiFactor || 0) * 100)}% — incentive ${esc(peso(r.incentiveEarned))} of ${esc(peso(r.incentiveFull))} possible</span><br/>
        Pay now ${esc(peso(r.nowPay))} → pay under the split ${esc(peso(r.proposedPay))}
      </div>
    </div>`;

  let currentRows = [];
  function paint() {
    const raw = parseFloat(baseInput ? baseInput.value : '');
    const baseAmount = Number.isFinite(raw) && raw >= 0 ? raw : window.OFFICE_SPLIT_DEFAULT_BASE;
    const { rows, noSalary } = computeRows(baseAmount);
    currentRows = rows;

    const totalPackage = rows.reduce((s, r) => s + r.package, 0);
    const totalNow = rows.reduce((s, r) => s + r.nowPay, 0);
    const totalProposed = rows.reduce((s, r) => s + r.proposedPay, 0);

    const totalsHtml = rows.length
      ? `<div class="py-problem"><div class="py-ptext"><strong>Whole Office Team — package ${esc(peso(totalPackage))}, pay now ${esc(peso(totalNow))} → pay under the split ${esc(peso(totalProposed))}</strong> — ${rows.length} ${rows.length === 1 ? 'person' : 'people'}.</div></div>`
      : '';

    const noSalaryHtml = noSalary.length
      ? `<div class="alert-banner" style="cursor:default;margin-bottom:8px"><span>${ico('⚠', 16)} No salary on file — skipped, not given a base: ${esc(noSalary.join(', '))}.</span></div>`
      : '';

    const otherSkippedHtml = otherSkipped.length
      ? `<p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${otherSkipped.length} on the Office roster ${otherSkipped.length === 1 ? 'is' : 'are'} not on this month's payable list, so ${otherSkipped.length === 1 ? 'is' : 'are'} not shown below: ${esc(otherSkipped.map(s => s.name + ' (' + s.reason + ')').join(', '))}.</p>`
      : '';

    previewBody.innerHTML = noSalaryHtml + otherSkippedHtml + totalsHtml +
      (rows.length ? rows.map(rowHtml).join('') : `<div class="py-sub">Nobody to show for ${esc(monthLabel)}.</div>`);

    if (window.lucide) lucide.createIcons({ nodes: [previewBody] });
    return { rows, baseAmount };
  }

  paint();
  if (baseInput) baseInput.addEventListener('input', paint);

  if (!canWrite) return;

  const resultHost = container.querySelector('#os-result');
  const renderResult = (title, ok, failed) => {
    if (!resultHost) return;
    resultHost.innerHTML = `
      <div class="py-problem"><div class="py-ptext"><strong>${esc(title)}</strong><br/>
      ${ok.length ? `${ico('✅', 14)} ${ok.length} ${ok.length === 1 ? 'person' : 'people'}: ${esc(ok.join(', '))}` : 'Nobody was applied.'}
      ${failed.length ? `<br/>${ico('⚠', 14)} ${failed.length} failed — left untouched: ${esc(failed.map(f => f.name + ' — ' + f.reason).join('; '))}` : ''}
      </div></div>`;
  };

  const applyBtn = container.querySelector('#os-apply');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => window.busy(applyBtn, async () => {
      const { rows, baseAmount } = paint(); // always apply exactly what's on screen right now
      if (!rows.length) { Notifs.showToast('Nothing to apply — the preview is empty.', 'error'); return; }
      const msg = `Apply the base/incentive split to ${rows.length} ${rows.length === 1 ? 'person' : 'people'}? Each person's protected base becomes ${peso(baseAmount)}; the rest becomes an incentive that only scales with performance once that pay method is separately turned on. Nobody's total package changes today.`;
      if (!(await window.confirmDialog({ message: msg, confirmLabel: 'Apply the split', cancelLabel: 'Cancel' }))) return;

      const rawByUid = {};
      officeRaw.forEach(u => { rawByUid[u.id] = u; });

      const ok = [], failed = [];
      for (const r of rows) {
        try {
          const existing = rawByUid[r.uid] || {};
          const already = existing.officeSplit && existing.officeSplit.active === true;
          // Captured ONCE — a second Apply must not overwrite the true
          // original with an already-split figure (see file header, "IDEMPOTENT + REVERSIBLE").
          const originalSalary = already ? existing.officeSplit.originalSalary : (existing.salary || 0);
          const originalAllowance = already ? existing.officeSplit.originalAllowance : (existing.allowance || 0);
          await db.collection('payroll').doc(r.uid).set({
            salary: r.proposedBase,
            allowance: r.proposedIncentive,
            officeSplit: {
              active: true, baseAmount,
              originalSalary, originalAllowance,
              appliedBy: (currentUser && currentUser.uid) || '',
              appliedByName: (window.userProfile && window.userProfile.displayName) || '',
              appliedAtLabel: (window.bizDate ? window.bizDate() : ''),
              appliedAt: firebase.firestore.FieldValue.serverTimestamp()
            }
          }, { merge: true });
          window.logAudit && window.logAudit('update', 'payroll', r.uid, { officeSplit: true, baseAmount, incentive: r.proposedIncentive });
          ok.push(r.name);
        } catch (e) {
          failed.push({ name: r.name, reason: e.message || e.code || String(e) });
        }
      }
      renderResult('Applied', ok, failed);
      if (ok.length) Notifs.success(`Base/incentive split applied to ${ok.length} ${ok.length === 1 ? 'person' : 'people'}.`);
      if (failed.length) Notifs.showToast(`${failed.length} could not be applied — see the list below. Nothing else was touched.`, 'error');
      window.renderOfficeSplitSection(container, currentUser, currentRole);
    }));
  }

  // ── The switch that makes the incentive actually scale ──────────────────
  // Separate from Apply on purpose. Apply restructures pay RECORDS and moves
  // nothing; this changes which arithmetic a live pay run uses. Same shape as
  // the task-based switch: President-only, confirmed, and it names the
  // consequence in pesos rather than saying "are you sure".
  const policyBtn = container.querySelector('#os-policy');
  if (policyBtn) {
    policyBtn.addEventListener('click', () => window.busy(policyBtn, async () => {
      const turningOn = !splitPolicyOn;
      // Re-read what is on screen RIGHT NOW, exactly as Apply does — a closure
      // captured at bind time would quote figures from before the base amount
      // was last edited, and this dialog's numbers are the whole basis for the
      // decision being made.
      const { rows } = paint();
      if (turningOn && !rows.length) {
        Notifs.showToast('Nobody has a base and incentive set up yet — apply the split first.', 'error'); return;
      }
      const totalNow = rows.reduce((s, r) => s + (Number(r.nowPay) || 0), 0);
      const totalNew = rows.reduce((s, r) => s + (Number(r.proposedPay) || 0), 0);
      // OFFICE-KPI-PAY-SPEC-2026-08-25 — this always targets 'basekpi' now,
      // whether coming from 'flat' (off) or from the legacy 'performance'
      // value (splitPolicyOn is false in both cases, so turningOn is true in
      // both cases) — there is no path left that writes 'performance' again.
      const msg = turningOn
        ? `Pay the incentive on this month's KPI from now on?\n\nOn this month's figures that is ${peso(totalNew)} across ${rows.length} ${rows.length === 1 ? 'person' : 'people'}, instead of ${peso(totalNow)}. Each person's protected base is paid in full either way — only the incentive above it moves, and attendance does not affect it.${floorMonthly == null ? '\n\nNo minimum wage amount is saved, so nothing is checking these figures against one.' : ''}`
        : `Stop paying the incentive on KPI?\n\nEveryone goes back to their full package — ${peso(totalNow)} across ${rows.length} ${rows.length === 1 ? 'person' : 'people'} on this month's figures.`;
      if (!(await window.confirmDialog({
        message: msg, confirmLabel: turningOn ? 'Pay on KPI' : 'Pay in full', cancelLabel: 'Cancel', danger: turningOn
      }))) return;
      try {
        await db.collection('settings').doc('payrollOfficePolicy').set({
          policy: turningOn ? 'basekpi' : 'flat',
          setBy: (window.currentUser && currentUser.uid) || null,
          setByName: (window.userProfile && userProfile.displayName) || null,
          setAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        window.logAudit && window.logAudit('update', 'settings', 'payrollOfficePolicy',
          { policy: turningOn ? 'basekpi' : 'flat' });
        Notifs.success(turningOn ? 'The incentive now scales with this month\'s KPI.' : 'Everyone is paid their full package again.');
      } catch (e) {
        Notifs.showToast('Could not change this: ' + ((e && e.message) || e), 'error'); return;
      }
      window.renderOfficeSplitSection(container, currentUser, currentRole);
    }));
  }

  const undoBtn = container.querySelector('#os-undo');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => window.busy(undoBtn, async () => {
      if (!alreadySplit.length) { Notifs.showToast('Nobody currently has the split applied.', 'error'); return; }
      const msg = `Undo the base/incentive split for ${alreadySplit.length} ${alreadySplit.length === 1 ? 'person' : 'people'}? Each person's salary and allowance return to what they were before the split was first applied.`;
      if (!(await window.confirmDialog({ message: msg, confirmLabel: 'Undo the split', cancelLabel: 'Cancel', danger: true }))) return;

      const ok = [], failed = [];
      for (const u of alreadySplit) {
        try {
          await db.collection('payroll').doc(u.id).set({
            salary: u.officeSplit.originalSalary || 0,
            allowance: u.officeSplit.originalAllowance || 0,
            officeSplit: {
              active: false,
              originalSalary: u.officeSplit.originalSalary || 0,
              originalAllowance: u.officeSplit.originalAllowance || 0,
              undoneBy: (currentUser && currentUser.uid) || '',
              undoneByName: (window.userProfile && window.userProfile.displayName) || '',
              undoneAtLabel: (window.bizDate ? window.bizDate() : ''),
              undoneAt: firebase.firestore.FieldValue.serverTimestamp()
            }
          }, { merge: true });
          window.logAudit && window.logAudit('update', 'payroll', u.id, { officeSplit: false });
          ok.push(u.displayName || u.email || u.id);
        } catch (e) {
          failed.push({ name: u.displayName || u.email || u.id, reason: e.message || e.code || String(e) });
        }
      }
      renderResult('Undone', ok, failed);
      if (ok.length) Notifs.success(`Base/incentive split undone for ${ok.length} ${ok.length === 1 ? 'person' : 'people'}.`);
      if (failed.length) Notifs.showToast(`${failed.length} could not be undone — see the list below. Nothing else was touched.`, 'error');
      window.renderOfficeSplitSection(container, currentUser, currentRole);
    }));
  }
};
