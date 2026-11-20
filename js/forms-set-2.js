/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Forms bodies, set 2
   js/forms-set-2.js — the sections of qc_checklist, delivery_receipt, installation_checklist, punch_list and client_acceptance
   (specs/SALES-FLOW-SPEC-2026-11-19.md §9.9, Phase 4 WP 4B), and of site_visit_report (Phase 5), same style as js/forms-set-1.js.
   ═══════════════════════════════════════════════════
   Lazy (js/forms.js loads it with the first of these forms; never in index.html). Each body is a pure function (data, h) → string[] of page
   sections; `data` is only what FormsCore.build() copied from the entry's DECLARED fields, `h` is FormsCore.makeHelpers(). The header, signature
   dividers, the review QR (client_acceptance: entry option `reviewQr`) and the footer are added by FormsCore.compose().

   THE PESO WALL. All five are Operations forms: no peso literal, no money formatter, no price column here (tests/forms-set-2.test.mjs scans this
   file), and h.peso() throws on an 'ops' form.

   BLANK-FIRST. Each form is a usable paper form from the job alone: empty tick boxes, ruled lines, spare rows and signature blocks. When the
   recorded fields exist (see the field-shape comment above the entries in forms-core.js) the ticks and notes print in the same boxes.          */
(function () {
  'use strict';
  const bodies = (window.FormsBodies = window.FormsBodies || {});

  const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';
  const dash = (v) => (has(v) ? v : '—');
  const BOX = '☐', TICK = '☑', CROSS = '☒';
  const partyParts = (d) => [d.clientAddress, has(d.clientPhone) ? '☎ ' + d.clientPhone : '', has(d.clientEmail) ? '✉ ' + d.clientEmail : ''];
  // an empty writable cell / row / ruled line (inline styles: the engine's sheet CSS is shared and pinned)
  const blankCell = (h, px) => h.raw(`<div style="height:${px || 15}px"></div>`);
  // blank ruled lines for handwriting (static markup; h.section takes an HTML string, not a raw-cell object)
  const ruled = (h, n) => Array.from({ length: n }, () => '<div style="border-bottom:1px solid #999;height:19px"></div>').join('');
  // pad a list of table rows with empty rows so the paper form always has room to write
  const pad = (rows, min, make) => { const out = rows.slice(); while (out.length < min) out.push(make(out.length)); return out; };
  const clientStrip = (d, h, label) => h.billStrip({ label: label || 'CLIENT', name: d.clientName, company: d.clientCompany, parts: partyParts(d), project: d.subject });

  // the job at a glance (job number, site, dates, work orders)
  function jobTable(d, h) {
    const rows = [{ head: true, label: 'Job Order', value: dash(d.jobOrderNo) }, { head: false, label: 'Delivery & Installation Site', value: dash(d.siteAddress) }];
    if (has(d.deliveryDate)) rows.push({ head: true, label: 'Delivery Date', value: h.date(d.deliveryDate) });
    if (has(d.deadline)) rows.push({ head: !has(d.deliveryDate) ? true : false, label: 'Deadline', value: h.date(d.deadline) });
    if ((d.workOrders || []).length) rows.push({ head: false, label: 'Work Orders', value: d.workOrders.join(', ') });
    return h.section('Job', h.infoTable(rows));
  }
  // the job order's item lines — # / description / qty / unit, no price column
  function itemsSection(d, h, title) {
    const lines = d.lines || [];
    const cols = [{ label: '#', w: '4%', a: 'c' }, { label: 'Description', w: '66%' }, { label: 'Qty', w: '15%', a: 'c' }, { label: 'Unit', w: '15%', a: 'c' }];
    const rows = lines.map((it, i) => {
      const desc = `<div class="nm">${has(it.code) ? `<span class="cd">${h.e(it.code)}</span>` : ''}${h.e(it.name) || 'Item'}</div>` +
        (has(it.dims) ? `<div class="sp">${h.e(it.dims)}</div>` : '') + (has(it.location) ? `<div class="sp" style="font-style:italic;">Location: ${h.e(it.location)}</div>` : '');
      return { cells: [String(i + 1), h.raw(desc), String(it.qty || 1), it.unit || 'pc'] };
    });
    return h.section(title, lines.length ? h.table({ cols, rows }) : h.note('No items are recorded on this job order yet.'), { flow: true });
  }
  const notesSection = (d, h, title) => h.section(title, has(d.notes) ? h.text(d.notes) : ruled(h, 3));

  // ═══════════════════════════════════════════════════
  //  qc_checklist — # / check / Pass / Fail / N/A / remarks; the work orders' recorded inspections; the overall result
  // ═══════════════════════════════════════════════════
  bodies.qc_checklist = function (d, h) {
    const out = [clientStrip(d, h), jobTable(d, h), itemsSection(d, h, 'Items Under Inspection')];
    const cols = [{ label: '#', w: '4%', a: 'c' }, { label: 'Inspection Check', w: '52%' }, { label: 'Pass', w: '9%', a: 'c' }, { label: 'Fail', w: '9%', a: 'c' }, { label: 'N/A', w: '9%', a: 'c' }, { label: 'Remarks', w: '17%' }];
    const mk = (c, i) => ({ cells: [String(i + 1), c.label ? c.label : blankCell(h), c.state === 'pass' ? TICK : BOX, c.state === 'fail' ? CROSS : BOX, c.state === 'na' ? TICK : BOX, has(c.note) ? c.note : (c.label ? '' : blankCell(h))] });
    const rows = pad((d.checks || []).map(mk), 8, (i) => mk({ label: '', state: '' }, i));
    out.push(h.section('Inspection Checks', h.table({ cols, rows }), { flow: true }));

    const wo = d.workOrderQc || [];
    if (wo.length) {
      out.push(h.section('Work-Order Inspections', h.table({ cols: [{ label: 'Work Order', w: '16%' }, { label: 'Item', w: '30%' }, { label: 'Result', w: '12%', a: 'c' }, { label: 'Inspector', w: '20%' }, { label: 'Date', w: '22%' }],
        rows: wo.map((x) => ({ cells: [dash(x.orderNo), dash(x.title), x.result === 'passed' ? 'PASSED' : x.result === 'failed' ? 'FAILED' : '—', dash(x.byName), has(x.date) ? h.date(x.date) : '—'] })) }) +
        wo.filter((x) => has(x.notes) || (x.failed || []).length).map((x) => h.note(`${x.orderNo || 'Work order'}: ${[(x.failed || []).length ? 'failed — ' + x.failed.join('; ') : '', x.notes].filter(has).join(' · ')}`)).join('')));
    }
    out.push(h.section('Overall Result', h.infoTable([{ head: true, cells: [`${d.result === 'passed' ? TICK : BOX}  Passed — release for delivery`, `${d.result === 'failed' ? CROSS : BOX}  Failed — rework, then re-inspect`] }])));
    out.push(notesSection(d, h, 'Inspection Notes'));
    return out;
  };

  // ═══════════════════════════════════════════════════
  //  delivery_receipt — the old production.js print on the standard header: Deliver To / Work Order, the line + 3 blank rows, notes
  // ═══════════════════════════════════════════════════
  bodies.delivery_receipt = function (d, h) {
    const out = [h.billStrip({ label: 'DELIVER TO', name: d.client }), h.section('Work Order', h.infoTable([{ head: true, label: 'Work Order', value: dash(d.orderNo) }]))];
    const cols = [{ label: '#', w: '6%', a: 'c' }, { label: 'Description', w: '80%' }, { label: 'Qty', w: '14%', a: 'c' }];
    const rows = [{ cells: ['1', has(d.itemTitle) ? d.itemTitle : '—', d.qty === null || d.qty === undefined ? '0' : h.int(d.qty)] }];
    for (let k = 1; k < 4; k++) rows.push({ cls: 'blank', cells: [String(k + 1), blankCell(h), blankCell(h)] });
    out.push(h.section('Items Delivered', h.table({ cols, rows })));
    if (has(d.notes)) out.push(h.section('Notes', h.text(d.notes)));
    return out;
  };

  // ═══════════════════════════════════════════════════
  //  installation_checklist — # / task / Done / Date / By; the items installed; site notes
  // ═══════════════════════════════════════════════════
  bodies.installation_checklist = function (d, h) {
    const out = [clientStrip(d, h), jobTable(d, h), itemsSection(d, h, 'Items To Install')];
    const cols = [{ label: '#', w: '4%', a: 'c' }, { label: 'Installation Task', w: '52%' }, { label: 'Done', w: '8%', a: 'c' }, { label: 'Date', w: '18%' }, { label: 'By', w: '18%' }];
    const mk = (c, i) => ({ cells: [String(i + 1), c.label ? c.label : blankCell(h), c.done ? TICK : BOX, has(c.date) ? h.date(c.date) : blankCell(h), has(c.by) ? c.by : blankCell(h)] });
    out.push(h.section('Installation Checks', h.table({ cols, rows: pad((d.checks || []).map(mk), 8, (i) => mk({ label: '' }, i)) }), { flow: true }));
    out.push(notesSection(d, h, 'Site Conditions & Notes'));
    return out;
  };

  // ═══════════════════════════════════════════════════
  //  punch_list — # / item / location / raised / Done / date cleared (at least 10 lines)
  // ═══════════════════════════════════════════════════
  bodies.punch_list = function (d, h) {
    const out = [clientStrip(d, h), jobTable(d, h), itemsSection(d, h, 'Works Covered')];
    const cols = [{ label: '#', w: '4%', a: 'c' }, { label: 'Item / Defect To Correct', w: '40%' }, { label: 'Location', w: '18%' }, { label: 'Raised', w: '14%' }, { label: 'Done', w: '8%', a: 'c' }, { label: 'Cleared On', w: '16%' }];
    const mk = (x, i) => ({ cells: [String(i + 1), x.text ? x.text : blankCell(h), x.text ? dash(x.location) : blankCell(h), has(x.raisedDate) ? h.date(x.raisedDate) : (x.text ? '—' : blankCell(h)),
      x.done ? TICK : BOX, has(x.doneDate) ? h.date(x.doneDate) : (x.text ? '' : blankCell(h))] });
    out.push(h.section('Punch List', h.table({ cols, rows: pad((d.items || []).map(mk), 10, (i) => mk({ text: '' }, i)) }), { flow: true }));
    const open = (d.items || []).filter((x) => !x.done).length;
    const status = has(d.clearedOn)
      ? `Punch list cleared on ${h.date(d.clearedOn)}${has(d.clearedBy) ? ' by ' + d.clearedBy : ''}.`
      : (d.items || []).length ? `${open} of ${d.items.length} item(s) still open.` : 'All items cleared:  ☐ Yes   Date: ____________________';
    out.push(h.section('Status', h.text(status)));
    return out;
  };

  // ═══════════════════════════════════════════════════
  //  site_visit_report (Phase 5, §5.6 V4) — what Rene found at the site: measurements, constraints, layout notes, how many photos and files.
  //  Blank-first like the others: a visit with no report yet prints as a fillable paper form. No money exists on this form for any login.
  // ═══════════════════════════════════════════════════
  bodies.site_visit_report = function (d, h) {
    const out = [clientStrip(d, h)];
    const visit = [{ head: true, label: 'Site Visit', value: dash(d.svRef) }, { head: false, label: 'Area', value: dash(d.areaLabel) },
      { head: true, label: 'Visit Date', value: has(d.visitDate) ? h.date(d.visitDate) : '—' }, { head: false, label: 'Site Address', value: dash(d.siteAddress) },
      { head: true, label: 'Contact at the Site', value: [d.contactPerson, d.contactPhone].filter(has).join(' · ') || '—' }];
    out.push(h.section('Site Visit', h.infoTable(visit)));
    const block = (title, text) => h.section(title, has(text) ? h.text(text) : ruled(h, 4));
    out.push(block('Measurements', d.measurements));
    out.push(block('Site Constraints', d.constraints));
    out.push(block('Layout Notes', d.layoutNotes));
    const files = (d.attachments || []).length ? 'Attachments: ' + d.attachments.join(', ') + '.' : 'No attachments.';
    out.push(h.section('Photos & Files', h.text((d.photoCount > 0 ? d.photoCount + ' photo' + (d.photoCount === 1 ? '' : 's') + ' on file. ' : 'No photos on file. ') + files)));
    if (has(d.reportBy)) out.push(h.section('Written By', h.text(d.reportBy + (has(d.reportOn) ? ' on ' + h.date(d.reportOn) : ''))));
    return out;
  };

  // ═══════════════════════════════════════════════════
  //  client_acceptance — what was delivered, the punch-list position, the acceptance statement, who accepted and when.
  //  The Google-review QR and its one line come from the engine (entry option reviewQr), under the signatures.
  // ═══════════════════════════════════════════════════
  bodies.client_acceptance = function (d, h) {
    const out = [clientStrip(d, h), jobTable(d, h), itemsSection(d, h, 'Works Delivered & Installed')];
    const done = has(d.acceptedOn) || has(d.signedBy);
    const punch = (d.punchCount || 0) > 0
      ? (d.punchOpen > 0 ? `${d.punchOpen} of ${d.punchCount} punch-list item(s) are still open and are to be completed after acceptance.` : `All ${d.punchCount} punch-list item(s) have been cleared.`)
      : 'No punch-list items are recorded.';
    out.push(h.section('Punch List', h.text(punch)));
    out.push(h.section('Acceptance', h.text(`I / We confirm that the works listed above have been delivered and installed at the site stated, were inspected together with a representative of ${h.short}, and are accepted in good order, except for any item recorded on the punch list.`) +
      h.infoTable([{ head: true, label: 'Acceptance', value: `${done && !(d.punchOpen > 0) ? TICK : BOX} In full    ${done && d.punchOpen > 0 ? TICK : BOX} With punch-list items still to be completed` },
        { head: false, label: 'Accepted by (printed name)', value: has(d.signedBy) ? d.signedBy : '____________________________' },
        { head: true, label: 'Date Accepted', value: has(d.acceptedOn) ? h.date(d.acceptedOn) : '____________________' },
        { head: false, label: 'Signed copy', value: d.signedCopy ? 'On file' : 'To be attached' }])));
    return out;
  };
})();
