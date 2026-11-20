/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Forms bodies, set 5 (the Sales forms of Phase 5)
   js/forms-set-5.js — the sections of site_visit_request and change_order (specs/SALES-FLOW-SPEC-2026-11-19.md §5.6, §5.7, §9.9), in the format of
   the quote builder's printed Quotation, same style as js/forms-set-1.js. (site_visit_report is an Operations form with no money: its body lives in
   js/forms-set-2.js, whose file-wide "no peso" scan then covers it.)
   ═══════════════════════════════════════════════════
   Lazy (js/forms.js loads it with the first of these forms; never in index.html). Each body is a pure function (data, h) → string[] of page
   sections: `data` is only what FormsCore.build() copied from the entry's DECLARED fields, `h` is FormsCore.makeHelpers(). The header, the signature
   dividers (here: closing the Terms section) and the thanks/creds footer come from FormsCore.compose().

   THE PESO WALL. Both forms carry pesos and are offered only to Sales, the books tier and the President (audience 'sales'). They never reach Production:
   FormsCore.canOpen refuses an Operations login, and Forms.buttonHtml renders '' for one.                                                       */
(function () {
  'use strict';
  const bodies = (window.FormsBodies = window.FormsBodies || {});

  const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';
  const dash = (v) => (has(v) ? v : '—');
  const money = (h, v) => (v === null || v === undefined ? '—' : h.peso(v));
  const signed = (h, v) => (v === null || v === undefined ? '—' : (v < 0 ? '−' : '+') + h.peso(Math.abs(v)));
  const partyParts = (d) => [d.clientAddress, has(d.clientPhone) ? '☎ ' + d.clientPhone : '', has(d.clientEmail) ? '✉ ' + d.clientEmail : ''];
  const card = (title, text, full) => ({ title, text, full: !!full });

  // ═══════════════════════════════════════════════════
  //  site_visit_request  — the request and (once its fee is confirmed) the fee acknowledgement
  // ═══════════════════════════════════════════════════
  bodies.site_visit_request = function (d, h) {
    const out = [];
    out.push(h.billStrip({ label: 'CLIENT', name: d.clientName, company: d.clientCompany, parts: partyParts(d) }));

    const visit = [
      { head: true, label: 'Area', value: dash(d.areaLabel) },
      { head: false, label: 'Visit Date', value: has(d.visitDate) ? h.date(d.visitDate) : '—' },
      { head: true, label: 'Site Address', value: dash(d.siteAddress) },
      { head: false, label: 'Contact at the Site', value: [d.contactPerson, d.contactPhone].filter(has).join(' · ') || '—' },
      { head: true, label: 'Status', value: dash(d.statusWord) },
    ];
    out.push(h.section('Site Visit', h.infoTable(visit) + (has(d.notes) ? h.text(d.notes) : '')));

    // the fee line shows the tariff for the area
    out.push(h.section('Site Visit Fee', h.infoTable([{ head: true, label: 'Fee for ' + (has(d.areaLabel) ? d.areaLabel : 'the area'), value: money(h, d.feeTariff) }]) +
      h.note('The fee is paid before the visit. If the client goes ahead with the job, the fee is credited against the contract price.')));

    // the acknowledgement part only exists once the fee is CONFIRMED (its payment claim is recorded)
    if (d.feeRecorded) {
      out.push(h.section('Fee Acknowledgement', h.infoTable([
        { head: true, label: 'Amount Received', value: money(h, d.feeAmount) },
        { head: false, label: 'Payment Method', value: dash(d.feeMethod) },
        { head: false, label: 'Reference No.', value: dash(d.feeReference) },
        { head: true, label: 'Date Received', value: has(d.feePaidOn) ? h.date(d.feePaidOn) : '—' },
        { head: false, label: 'Acknowledgement No.', value: dash(d.paRef) }]) + h.note(d.notice)));
    }

    out.push(h.section('Terms & Conditions', h.cards([
      card('Site Visit', `${h.short} visits the site to measure and survey it. The visit date is confirmed once the fee is received.`),
      card('Site Access', 'The client makes sure the site can be entered on the visit date and the contact person above is available.'),
    ]) + h.sigRow()));
    return out;
  };

  // ═══════════════════════════════════════════════════
  //  change_order  — for the client's signature: the lines, the price difference, the added down payment, the new contract amount
  // ═══════════════════════════════════════════════════
  bodies.change_order = function (d, h) {
    const out = [];
    out.push(h.billStrip({ label: 'CLIENT', name: d.clientName, company: d.clientCompany, parts: partyParts(d), project: d.subject }));

    const asked = [];
    if (has(d.details)) asked.push(h.text(d.details));
    if (d.deadlineDays !== null && d.deadlineDays !== undefined && d.deadlineDays !== 0) {
      asked.push(h.infoTable([{ head: true, label: 'Effect on the Deadline', value: (d.deadlineDays > 0 ? '+' : '−') + Math.abs(d.deadlineDays) + ' calendar day' + (Math.abs(d.deadlineDays) === 1 ? '' : 's') }]));
    }
    if (asked.length) out.push(h.section('Change Requested', asked.join('')));

    // the lines: ADDED first, then REMOVED (their amounts are negative), the quote's band rows
    const cols = [{ label: '#', w: '4%', a: 'c' }, { label: 'Description', w: '48%' }, { label: 'Qty', w: '8%', a: 'c' }, { label: 'Unit', w: '8%', a: 'c' },
      { label: 'Unit Price', w: '15%', a: 'r' }, { label: 'Amount', w: '17%', a: 'r' }];
    const lines = d.lines || [];
    const rows = [];
    let n = 0;
    [['added', 'Added'], ['removed', 'Removed']].forEach(([kind, label]) => {
      const part = lines.filter((l) => l.kind === kind);
      if (!part.length) return;
      rows.push({ cat: label });
      part.forEach((l) => {
        n += 1;
        rows.push({ cells: [String(n), h.raw(`<div class="nm">${h.e(l.name) || '—'}</div>`), l.qty === null ? '—' : h.int(l.qty), l.unit, money(h, l.unitPrice), signed(h, l.amount)] });
      });
    });
    const totals = [
      { label: 'Current Contract Amount', amt: money(h, d.contractBefore) },
      { label: 'This Change Order', amt: signed(h, d.price) },
      { label: 'NEW CONTRACT AMOUNT', amt: money(h, d.contractAfter), cls: 'grand' },
    ];
    out.push(h.section('Change Order Items', (lines.length ? h.table({ cols, rows }) : h.note('No lines are priced on this change order yet.')) +
      h.totals(totals, 'All amounts in Philippine Peso (₱).', { firstCol: '66%' }), { flow: true }));

    out.push(h.section('Payment', h.infoTable([{ head: true, label: 'Added Down Payment — due before work on the change starts', value: d.addedDownPayment > 0 ? money(h, d.addedDownPayment) : 'None' }]) +
      (d.price > 0 ? h.note('The rest of this change order is added to the balance of the contract.') : '') +
      (d.appliedRev > 0 ? h.note('Applied to the contract as revision R' + d.appliedRev + '.') : '')));

    out.push(h.section('Terms & Conditions', h.cards([
      card('Acceptance', 'By signing this change order, the client accepts the change described above, its price and the new contract amount.'),
      card('When It Takes Effect', 'This change order takes effect once both parties have signed it and the added down payment, if any, is received. Every other term of the contract stays the same.'),
    ]) + h.sigRow()));
    return out;
  };
})();
