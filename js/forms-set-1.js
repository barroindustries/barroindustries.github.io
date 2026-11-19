/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Forms bodies, set 1
   js/forms-set-1.js — the sections of sales_order, job_order, payment_ack and handoff_pack (specs/SALES-FLOW-SPEC-2026-11-19.md §9.9), in the
   format of the quote builder's printed Quotation as reviewed in the ops-flow prototype (owner rulings 2026-11-19). The quote's subject is folded into
   the bill-to strip as its grey "Project:" line.
   ═══════════════════════════════════════════════════
   Lazy (js/forms.js loads it on the first use of one of these forms; never in index.html). Each body is a pure function  (data, h) → string[]
   of page sections: `data` is the object FormsCore.build() made from the entry's DECLARED fields and nothing else — a body is never handed the
   record — and `h` is FormsCore.makeHelpers(): the quote builder's own section / table / totals / pay-tbl / terms-card markup. Text passed to h.*
   is escaped there; markup must be wrapped in h.raw(). The header, the signature dividers (unless a body closes with its own terms section, like
   the quote) and the thanks/creds footer are added by FormsCore.compose().

   THE PESO WALL. job_order and handoff_pack are the WORKFORCE COPY — NO PRICES: no peso literal, no money formatter, no price column in their
   bodies (tests/forms-wiring.test.mjs scans them), and h.peso() throws on an 'ops' form. sales_order and payment_ack carry pesos, and are only
   offered to Sales, the books tier and the President (FormsCore.canOpen).                                                                         */
(function () {
  'use strict';
  const bodies = (window.FormsBodies = window.FormsBodies || {});

  // ── shared pieces ───────────────────────────────────────────────────────────────────────────────────────
  const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';
  const money = (h, v) => (v === null || v === undefined ? '—' : h.peso(v));
  const signed = (h, v) => (v === null || v === undefined ? '—' : (v < 0 ? '−' : '+') + h.peso(Math.abs(v)));
  const sumOf = (rows) => { let s = 0; for (const r of rows) { if (r.amount === null || r.amount === undefined) return null; s += r.amount; } return s; };
  // lines of the same section share one band (the quote's .cat-row), sections in the order they first appear — as the quotation groups them
  const groupBy = (lines, key) => {
    const groups = [], at = new Map();
    lines.forEach((l) => { const k = l[key] || ''; if (at.has(k)) groups[at.get(k)].rows.push(l); else { at.set(k, groups.length); groups.push({ label: k, rows: [l] }); } });
    return groups;
  };
  const nameHtml = (h, l, dflt) => `<div class="nm">${has(l.code) ? `<span class="cd">${h.e(l.code)}</span>` : ''}${h.e(l.name) || dflt}</div>`;
  const partyParts = (d, k) => [d[k.address], has(d[k.phone]) ? '☎ ' + d[k.phone] : '', has(d[k.email]) ? '✉ ' + d[k.email] : ''];
  // the quote's standard terms (TERMS_DEF in quote-builder-v2.html), as reviewed in the prototype
  const TERM = {
    completion: ['Completion', 'Work will be completed within the agreed timeline from date of down payment receipt. Delays due to client-side changes or site issues are not included.'],
    payment: ['Payment Terms', 'Down payment due upon confirmation; balance settled per the Payment Schedule above. All payments are non-refundable once fabrication has commenced.'],
    warranty: ['Warranty', '6-month service warranty on our equipment and work. Warranty does not cover misuse, physical damage, or failure to maintain the equipment.'],
    scope: ['Scope of Work', 'Price covers fabrication, delivery, and installation as specified. Electrical works, gas connections, and civil works are excluded unless stated.'],
    acceptance: ['Acceptance', 'By signing this sales order, the client accepts all terms and conditions stated herein.'],
  };
  const card = (t, full) => ({ title: t[0], text: t[1], full: !!full });
  const dash = (v) => (has(v) ? v : '—');

  // ═══════════════════════════════════════════════════
  //  sales_order  (pesos · Sales, books tier, President)
  // ═══════════════════════════════════════════════════
  bodies.sales_order = function (d, h) {
    const out = [];
    out.push(h.billStrip({ label: 'BILL TO', name: d.clientName, company: d.clientCompany, parts: partyParts(d, { address: 'clientAddress', phone: 'clientPhone', email: 'clientEmail' }), project: d.subject }));

    // items — the quote's items table without the Actions column (its print widths for Barro Kitchens / Barro Industries)
    const cols = [{ label: '#', w: '4%', a: 'c' }, { label: 'Description', w: '54%' }, { label: 'Qty', w: '7%', a: 'c' }, { label: 'Unit', w: '7%', a: 'c' },
      { label: 'Unit Price', w: '12%', a: 'r' }, { label: 'Amount', w: '16%', a: 'r' }];
    const lines = d.lines || [];
    const groups = groupBy(lines, 'cat');
    const bands = groups.some((g) => g.label);
    const rows = [];
    let n = 0;
    groups.forEach((g) => {
      if (bands && g.label) rows.push({ cat: g.label });
      g.rows.forEach((l) => {
        n += 1;
        const desc = nameHtml(h, l, '—') + (has(l.dims) ? `<div class="sp">${h.e(l.dims)}</div>` : '') + (has(l.specs) ? `<div class="sp">${h.e(l.specs)}</div>` : '');
        rows.push({ cells: [String(n), h.raw(desc), l.qty === null ? '—' : h.int(l.qty), l.unit, money(h, l.unitPrice), money(h, l.amount)] });
      });
      const sub = sumOf(g.rows);
      if (bands && g.label && sub !== null) rows.push({ sub: h.raw('Subtotal — ' + h.e(g.label) + ': ' + h.e(h.peso(sub))) });
    });
    const totals = [];
    const ladder = d.ladder || [];
    if (ladder.length) ladder.forEach((r) => totals.push({ label: r.label, amt: (r.amt < 0 ? '−' : '') + h.peso(Math.abs(r.amt)), cls: r.cls }));
    else { const s = sumOf(lines); if (s !== null && lines.length && d.contract !== null && Math.abs(s - d.contract) < 0.01) totals.push({ label: 'Subtotal', amt: h.peso(s) }); }
    totals.push({ label: 'GRAND TOTAL', amt: money(h, d.contract), cls: 'grand' });
    out.push(h.section('Order Items', (lines.length ? h.table({ cols, rows }) : h.note('No line items are recorded on this order.')) +
      h.totals(totals, 'All amounts in Philippine Peso (₱)' + (has(d.vatNote) ? ', ' + d.vatNote : '') + '.'), { flow: true }));

    // payment — the quote's Payment Terms & Schedule: contract, what was received, what is left (banded rows)
    const revTag = d.revTag;
    const pay = [{ head: true, label: 'Total Contract Price' + (has(revTag) ? ` (revised, ${revTag})` : ''), value: money(h, d.contract) }];
    (d.payments || []).forEach((p, i) => {
      const pct = i === 0 && p.label === 'Down Payment' && d.dpPercent ? ` (${d.dpPercent}%)` : '';
      const tail = has(p.pa) ? p.pa : (has(p.reference) ? 'Ref. ' + p.reference : '');
      pay.push({ head: false, label: `${p.label}${pct} — received${has(p.date) ? ' ' + h.date(p.date) : ''}${tail ? ' · ' + tail : ''}`, value: money(h, p.amount) });
    });
    if (!(d.payments || []).length) pay.push({ head: false, label: 'No payment has been confirmed yet', value: '—' });
    if (d.credited > 0) pay.push({ head: false, label: 'Of which: site-visit fee credited', value: money(h, d.credited) });
    const paidUp = d.balance !== null && d.balance !== undefined && d.balance <= 0;
    pay.push({ head: true, label: 'Balance' + (has(revTag) ? ` (recalculated after ${revTag})` : '') + ' — ' + (paidUp ? 'fully paid' : (has(d.balanceTerms) ? d.balanceTerms : 'due')), value: money(h, d.balance) });
    out.push(h.section('Payment', h.infoTable(pay)));

    const tl = d.timeline || {};
    const sched = [];
    if (has(tl.start)) sched.push({ label: 'Start Date (basis)', value: h.date(tl.start) });
    if (has(tl.lead)) sched.push({ label: 'Overall Lead Time', value: tl.lead });
    if (has(tl.completion)) sched.push({ label: 'Estimated Completion', value: h.date(tl.completion) });
    if (sched.length) out.push(h.section('Project Timeline & Completion', h.infoTable(sched)));

    const revs = d.revisions || [];
    if (revs.length) {
      out.push(h.section('Revision History', h.table({ cols: [{ label: 'Revision', w: '14%' }, { label: 'Date', w: '22%' }, { label: 'Reason', w: '40%' }, { label: 'Adjustment', w: '24%', a: 'r' }],
        rows: revs.slice().reverse().map((r) => ({ cells: [r.rev, has(r.date) ? h.date(r.date) : '—', dash(r.reason), signed(h, r.delta)] })) })));
    }

    // terms & conditions — grey two-column cards, and the signature dividers closing the section, as the quote does
    out.push(h.section('Terms & Conditions', h.cards([card(TERM.completion), card(TERM.payment), card(TERM.warranty), card(TERM.scope),
      { title: 'Site Requirements', text: `Client is responsible for ensuring site is ready for installation. ${h.short} is not liable for delays due to unprepared site conditions.` },
      card(TERM.acceptance)]) + h.sigRow()));
    return out;
  };

  // ═══════════════════════════════════════════════════
  //  payment_ack  (pesos · only for a CONFIRMED payment — FormsCore guard)
  // ═══════════════════════════════════════════════════
  bodies.payment_ack = function (d, h) {
    const out = [];
    out.push(h.billStrip({ label: 'RECEIVED FROM', name: d.clientName, company: d.clientCompany, parts: partyParts(d, { address: 'clientAddress', phone: 'clientPhone', email: 'clientEmail' }), project: d.subject }));
    const forText = (has(d.kindLabel) ? d.kindLabel : 'Payment') + (d.dpPercent ? ` (${d.dpPercent}%)` : '') + (has(d.soRef) ? ' — ' + d.soRef : '');
    out.push(h.section('Payment Received', h.infoTable([
      { head: true, label: 'Amount Received', value: money(h, d.amount) }, { head: false, label: 'Payment Method', value: dash(d.method) },
      { head: false, label: 'Reference No.', value: dash(d.reference) }, { head: true, label: 'Date Received', value: has(d.paidOn) ? h.date(d.paidOn) : '—' },
      { head: false, label: 'Payment For', value: forText }])));
    out.push(h.section('Account Summary', h.infoTable([
      { head: true, label: 'Total Contract Price', value: money(h, d.contract) }, { head: false, label: 'Total Paid to Date', value: money(h, d.paidToDate) },
      { head: true, label: 'Balance Due', value: money(h, d.balanceDue) }])));
    out.push(h.section('Terms & Conditions', h.cards([
      { title: 'Acknowledgement', text: `This document acknowledges the payment stated above, received by ${h.short}. It records the amount, method, reference and date of the payment.` },
      card(TERM.payment), { title: 'Note', text: d.notice, full: true }]) + h.sigRow()));
    return out;
  };

  // ═══════════════════════════════════════════════════
  //  job_order  (WORKFORCE COPY — NO PRICES · every staff profile; identical for every viewer)
  // ═══════════════════════════════════════════════════
  // The scope table both workforce copies share: # / DESCRIPTION / QTY / UNIT only — no price column, no total.
  function crewItems(d, h, title) {
    const cols = [{ label: '#', w: '4%', a: 'c' }, { label: 'Description', w: '66%' }, { label: 'Qty', w: '15%', a: 'c' }, { label: 'Unit', w: '15%', a: 'c' }];
    const lines = d.lines || [];
    const groups = groupBy(lines, 'catLabel');
    const bands = groups.length > 1;
    const rows = [];
    let n = 0;
    groups.forEach((g) => {
      if (bands && g.label) rows.push({ cat: g.label });
      g.rows.forEach((it) => {
        n += 1;
        const la = [has(it.location) ? 'Location: ' + it.location : '', has(it.adjustment) ? 'Adjustment: ' + it.adjustment : ''].filter(has).join(' · ');
        const desc = nameHtml(h, it, 'Item') + (has(it.dims) ? `<div class="sp">${h.e(it.dims)}</div>` : '') + (has(it.specs) ? `<div class="sp">${h.e(it.specs)}</div>` : '') +
          (la ? `<div class="sp" style="font-style:italic;">${h.e(la)}</div>` : '') + (has(it.notes) ? `<div class="sp" style="font-style:italic;">${h.e(it.notes)}</div>` : '');
        rows.push({ cells: [String(n), h.raw(desc), String(it.qty || 1), it.unit || 'pc'] });
      });
    });
    return h.section(title, (lines.length ? h.table({ cols, rows }) : h.note('No scope has been entered for this job yet.')) + h.tolerance(), { flow: true });
  }
  const crewRequests = (d) => [has(d.instructions) ? d.instructions : '', has(d.salesNotes) ? 'Notes from Sales / Design: ' + d.salesNotes : ''].filter(has).join('\n');

  bodies.job_order = function (d, h) {
    const out = [];
    out.push(h.billStrip({ label: 'CLIENT', name: d.clientName, company: d.clientCompany, parts: partyParts(d, { address: 'clientAddress', phone: 'clientPhone', email: 'clientEmail' }), project: d.subject }));
    out.push(crewItems(d, h, 'Job Order Items'));
    const sched = [{ label: 'Start Date (basis)', value: has(d.startDate) ? h.date(d.startDate) : '—' }];
    if (has(d.deliveryDate)) sched.push({ label: 'Delivery Date', value: h.date(d.deliveryDate) });
    sched.push({ label: 'Deadline', value: has(d.deadline) ? h.date(d.deadline) : '—' });
    if (has(d.siteAddress)) sched.push({ label: 'Delivery & Installation Site', value: d.siteAddress });
    if ((d.workOrders || []).length) sched.push({ label: 'Work Orders', value: d.workOrders.join(', ') });
    const dr = (d.drawings || []).map((x) => x.title + ' (Rev ' + x.rev + ')').concat(has(d.clientDrawing) ? [d.clientDrawing + ' (client-supplied)'] : []);
    sched.push({ label: 'Drawings', value: dr.length ? h.raw(dr.map(h.e).join('<br>')) : 'Not drawn yet' });
    out.push(h.section('Project Timeline & Completion', h.infoTable(sched)));
    out.push(h.section('Special Requests', h.text(crewRequests(d) || 'None')));
    const revs = d.revisions || [];
    if (revs.length) {
      out.push(h.section('Revision History', h.table({ cols: [{ label: 'Revision', w: '14%' }, { label: 'Date', w: '22%' }, { label: 'Note', w: '64%' }],
        rows: revs.slice().reverse().map((r) => ({ cells: [r.rev, has(r.date) ? h.date(r.date) : '—', r.note] })) })));
    }
    return out;
  };

  // ═══════════════════════════════════════════════════
  //  handoff_pack  (WORKFORCE COPY — NO PRICES · SF8: no pesos, not even a budget)
  // ═══════════════════════════════════════════════════
  bodies.handoff_pack = function (d, h) {
    const out = [];
    out.push(h.billStrip({ label: 'CLIENT', name: d.clientName, company: d.clientCompany, parts: partyParts(d, { address: 'contactAddress', phone: 'contactPhone', email: 'contactEmail' }), project: d.subject }));
    out.push(crewItems(d, h, 'Scope of Work'));
    const sched = [{ label: 'Job Order', value: d.jobOrderNo }];
    if (has(d.releasedOn)) sched.push({ label: 'Released to Production', value: h.date(d.releasedOn) });
    sched.push({ label: 'Start Date (basis)', value: has(d.startDate) ? h.date(d.startDate) : '—' });
    if (has(d.deliveryDate)) sched.push({ label: 'Delivery Date', value: h.date(d.deliveryDate) });
    sched.push({ label: 'Deadline', value: has(d.deadline) ? h.date(d.deadline) : '—' });
    if (has(d.priority)) sched.push({ label: 'Priority', value: d.priority });
    sched.push({ label: 'Delivery & Installation Site', value: has(d.siteAddress) ? d.siteAddress : '—' });
    if ((d.workOrders || []).length) sched.push({ label: 'Work Orders', value: d.workOrders.join(', ') });
    out.push(h.section('Project Timeline & Completion', h.infoTable(sched)));

    const dw = d.drawings || [];
    let dwHtml = dw.length
      ? h.table({ cols: [{ label: 'Drawing', w: '80%' }, { label: 'Rev', w: '20%', a: 'c' }], rows: dw.map((x) => ({ cells: [x.title, x.rev] })) })
      : h.note('No released drawings are on file for this job.');
    if (d.drawingsHeld > 0) dwHtml += h.note(d.drawingsHeld + ' more drawing(s) are not released yet — build only from released revisions.');
    if (has(d.clientDrawing)) dwHtml += h.note('Client-supplied drawing: ' + d.clientDrawing);
    out.push(h.section('Drawings', dwHtml));
    out.push(h.section('Special Requests', h.text(crewRequests(d) || 'None')));
    return out;
  };
})();
