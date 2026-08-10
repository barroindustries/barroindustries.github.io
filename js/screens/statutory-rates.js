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
