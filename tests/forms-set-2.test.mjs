// tests/forms-set-2.test.mjs — Work Package 4B: the five Operations forms on the forms engine (js/forms-set-2.js + their entries in js/forms-core.js),
// specs/SALES-FLOW-SPEC-2026-11-19.md §9.9 (qc_checklist, delivery_receipt, installation_checklist, punch_list, client_acceptance).
//
// WHAT IT PINS
//   1. REGISTRY  five 'ops' entries, no money field, body set js/forms-set-2.js; the review QR option on client_acceptance only.
//   2. AUDIENCE  Production (Rene), the President and every other staff login prepare and compose each form; a login with no role is refused.
//   3. PESO WALL no "₱" anywhere on any of the five for any login; a price typed into a note is REFUSED (peso-in-text), not printed; h.peso() throws;
//                the body file contains no peso formatter.
//   4. BLANK     each form prints as a fillable paper form from the job alone (job no., client, site, the job order's item lines, empty boxes,
//                spare rows, signature blocks) and prints the recorded ticks / notes when the fields exist.
//   5. NUMBERS   QC-/INS-/PL-/ACC- + the job order number (derived, no counter written), delivery_receipt keeps its stored DR serial; file names.
//   6. QR        client_acceptance carries the Google-review QR (local inline SVG, no network) and the one plain line; the other four do not.
//   7. DR        the delivery receipt carries the content of the old production.js print.
// Mutation-checked in a scratch copy (see the report).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { read, setupForms, fixtures, PEOPLE } from './fixtures/forms-env.mjs';

const require = createRequire(import.meta.url);
const FC = setupForms();
require('../js/forms-set-2.js');
require('../js/qrcode.js');                       // the vendored encoder → window.buildQRSVG (what Forms loads through the entry's `needs`)

const IDS = ['qc_checklist', 'delivery_receipt', 'installation_checklist', 'punch_list', 'client_acceptance'];
const JOB_IDS = ['qc_checklist', 'installation_checklist', 'punch_list', 'client_acceptance'];
const LOGINS = Object.entries(PEOPLE).filter(([k]) => k !== 'nobody');
const REVIEW_URL = 'https://g.page/r/CTfy7v-fDzwEEBM/review';
const REVIEW_LINE = 'Happy with our work? Scan to leave us a Google review.';

const { project, order, client } = fixtures();
const workOrder = () => ({ id: 'woAbCdEf9876', orderNo: 'WO-2026-0007', title: 'Canopy hood 2400 mm', qty: 3, client: 'Mamitas Bulaluhan', quoteRef: 'BKMLFB260730-001R3', projectId: 'projXyz1' });
const ctxOf = (id, viewer, extra) => {
  const base = { today: '2026-11-20', client, viewer, workOrders: [], drawings: [] };
  if (id === 'delivery_receipt') return Object.assign(base, { order: workOrder(), project: JSON.parse(JSON.stringify(project)) }, extra);
  return Object.assign(base, { project: JSON.parse(JSON.stringify(project)), order: JSON.parse(JSON.stringify(order)) }, extra);
};
const compose = (id, viewer, extra) => {
  const prep = FC.prepare(id, ctxOf(id, viewer, extra));
  assert.ok(prep.ok, id + ': ' + (prep.error || ''));
  const page = FC.compose(prep, FC.renderSections(prep));
  return { prep, page, html: page.bodyHtml };
};
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
// a project carrying the recorded fields
const recorded = (id) => {
  const p = JSON.parse(JSON.stringify(project));
  const jo = p.jobOrder;
  jo.qcChecks = ['Welds ground smooth', 'Dimensions verified', 'Footings installed'];
  jo.qcTicks = [{ label: 'Welds ground smooth', state: 'pass' }, { label: 'Dimensions verified', state: 'fail', note: 'Hood 4mm short' }, { label: 'Footings installed', state: 'na' }];
  jo.qcNotes = 'Re-cut the hood panel.';
  jo.installChecks = ['Units levelled', 'Grease trap connected'];
  jo.installTicks = [{ label: 'Units levelled', done: true, date: '2026-12-16', by: 'RP' }];
  jo.installNotes = 'Gas line not yet connected by client.';
  p.punchList = { items: [{ text: 'Scratch on sink front', location: 'Wash area', raisedDate: '2026-12-16', done: true, doneDate: '2026-12-17' }, { text: 'Loose shelf bracket', location: 'Prep table' }], clearedAt: null, clearedBy: '' };
  p.acceptance = { url: 'https://example.invalid/signed.pdf', name: 'acceptance.pdf', signedBy: 'Maria Santos', date: '2026-12-18', by: 'u-ren', byName: 'Rene Palles', at: '2026-12-18T05:00:00Z' };
  return p;
};
const recordedCtx = (id, viewer) => {
  if (id === 'delivery_receipt') {
    const wo = Object.assign(workOrder(), { deliveryReceipt: { no: 'DR-2026-000042', receivedBy: 'Maria Santos', date: '2026-12-15', notes: 'One box dented on arrival', byName: 'Rene Palles' } });
    return { order: wo };
  }
  return { project: recorded(id), workOrders: [{ orderNo: 'WO-2026-0007', title: 'Canopy hood', qc: { result: 'failed', items: [{ label: 'Welds', state: 'pass' }, { label: 'Dimensions', state: 'fail' }], notes: 'Rework', byName: 'McArthur Sarabia', at: '2026-12-10T03:00:00Z' } }] };
};

describe('1. the registry', () => {
  it('five Operations entries on the engine: no money field, body set 2, portrait', () => {
    for (const id of IDS) {
      const e = FC.get(id);
      assert.ok(e, id + ' is registered');
      assert.equal(e.audience, 'ops'); assert.equal(e.bodySet, 'js/forms-set-2.js'); assert.equal(e.orientation, 'portrait');
      for (const f of e.fields) { assert.ok(!f.money, `${id}.${f.key}`); assert.doesNotMatch(f.key, FC.PESO_KEY, `${id}.${f.key} is a price-like name`); }
    }
    assert.deepEqual(IDS.map((id) => FC.get(id).title), ['QC CHECKLIST', 'DELIVERY RECEIPT', 'INSTALLATION CHECKLIST', 'PUNCH LIST', 'CLIENT ACCEPTANCE FORM']);
  });
  it('the job-based forms need production.js (joDoc); client_acceptance also the vendored QR encoder; the delivery receipt needs nothing', () => {
    for (const id of ['qc_checklist', 'installation_checklist', 'punch_list']) assert.deepEqual(FC.get(id).needs, ['js/screens/production.js']);
    assert.deepEqual(FC.get('client_acceptance').needs, ['js/screens/production.js', 'js/qrcode.js']);
    assert.deepEqual(FC.get('delivery_receipt').needs, []);
  });
  it('registering an ops form with a money field is still refused (the wall at registration)', () => {
    assert.throws(() => FC.register({ id: 't_ops_money', title: 'TEST FORM', audience: 'ops', fields: [{ key: 'x', money: true }] }), (e) => e.code === 'ops-money-field');
    assert.equal(FC.get('t_ops_money'), null);
  });
  it('only client_acceptance asks for the review QR', () => {
    assert.deepEqual(FC.list().filter((e) => e.reviewQr).map((e) => e.id), ['client_acceptance']);
  });
});

describe('2. audience: Production and the President (and every staff login) open all five; no role opens none', () => {
  for (const id of IDS) {
    for (const [k, v] of LOGINS) {
      it(`${id} composes for ${k}`, () => {
        assert.equal(FC.canOpen(id, v), true);
        const { page } = compose(id, v);
        assert.ok(page.bodyHtml.includes('class="frm"') && page.fileName.endsWith('.pdf'));
      });
    }
    it(`${id} is refused to a login with no role`, () => {
      const prep = FC.prepare(id, ctxOf(id, PEOPLE.nobody));
      assert.equal(prep.ok, false); assert.equal(prep.code, 'not-allowed');
    });
  }
  it('a missing job / work order is refused with a plain message', () => {
    for (const id of JOB_IDS) assert.equal(FC.prepare(id, { viewer: PEOPLE.rene, today: '2026-11-20' }).error, 'We could not find that job.');
    assert.equal(FC.prepare('delivery_receipt', { viewer: PEOPLE.rene, today: '2026-11-20' }).error, 'We could not find that work order.');
  });
});

describe('3. the peso wall: no ₱ on any of the five for any login', () => {
  for (const id of IDS) {
    it(`${id}: blank and recorded, for every login, the page and its data carry no peso`, () => {
      for (const [k, v] of LOGINS) {
        for (const extra of [undefined, recordedCtx(id, v)]) {
          const { html, prep } = compose(id, v, extra);
          assert.ok(!html.includes('₱'), `${id} for ${k} prints a peso`);
          assert.doesNotMatch(html, /\bPHP\b|\bPhp\b/, `${id} for ${k}`);
          assert.doesNotMatch(JSON.stringify(prep.data), /unitPrice|amount|contractAmount|arBalance|capital|150000|75000|41000|20000|35000/, `${id} data`);
        }
      }
    });
    it(`${id}: a price typed into a note is refused, not printed`, () => {
      const ctx = ctxOf(id, PEOPLE.rene);
      if (id === 'delivery_receipt') ctx.order.deliveryReceipt = { no: 'DR-1', notes: 'Balance ₱5,000 to collect' };
      else {   // each form reads its own recorded field: qc/install their notes, punch_list its items, client_acceptance who accepted
        ctx.project.jobOrder = Object.assign({}, ctx.project.jobOrder, { qcNotes: 'Pay ₱5,000', installNotes: 'Pay ₱5,000' });
        ctx.project.punchList = { items: [{ text: 'Fix for ₱500' }] };
        ctx.project.acceptance = { signedBy: 'Ma. Santos ₱' };
      }
      const prep = FC.prepare(id, ctx);
      // qc / install read their own notes; punch_list reads the items; acceptance reads signedBy; the DR reads its notes
      assert.equal(prep.ok, false, id + ' printed a peso'); assert.equal(prep.code, 'peso-in-text'); assert.equal(prep.error, FC.PESO_IN_TEXT_MESSAGE);
    });
  }
  it('h.peso() throws for these forms, and the body file has no peso formatter or sign', () => {
    for (const id of IDS) assert.throws(() => FC.makeHelpers(FC.get(id)).peso(5), (e) => e.code === 'peso-on-ops');
    const code = read('js/forms-set-2.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const bad of [/₱/, /\bh\.peso\b/, /\bmoney\s*\(/, /\bfmtN?2?\s*\(/, /\bPHP\b|\bPhp\b/, /toLocaleString\(/, /Intl\.NumberFormat/, /\bpesos?\b/i]) assert.doesNotMatch(code, bad, String(bad));
  });
});

describe('4. blank vs filled', () => {
  it('every job form is a usable blank from the job alone: job no., client, site, item lines, empty boxes, signature blocks', () => {
    for (const id of JOB_IDS) {
      const { html } = compose(id, PEOPLE.rene);
      const t = text(html);
      assert.ok(t.includes('JO-'), id + ' carries the job number');
      assert.ok(t.includes('Mamitas Bulaluhan') && t.includes('12 Aurora Blvd., Quezon City'), id + ' client and site');
      assert.ok(t.includes('Work table with undershelf') && t.includes('Canopy hood'), id + ' item lines from the job order');
      assert.ok(html.includes('☐'), id + ' has empty boxes');
      assert.ok(html.includes('class="sig-row') && html.includes('sig-role'), id + ' has signature blocks');
      assert.ok(!html.includes('☑') && !html.includes('☒'), id + ' blank carries no ticks');
    }
  });
  it('the blank checklists show the job order\'s own check lists (house standard text) and spare rows; the punch list has at least ten lines', () => {
    const qc = text(compose('qc_checklist', PEOPLE.rene).html);
    assert.ok(qc.includes('All welds ground smooth'));
    assert.ok(text(compose('installation_checklist', PEOPLE.rene).html).includes('Units positioned per approved site layout'));
    const pl = compose('punch_list', PEOPLE.rene).html;
    assert.ok((pl.match(/<tr>/g) || []).length >= 10);
    assert.ok(text(pl).includes('All items cleared'));
  });
  it('QC checklist: recorded ticks print in the boxes, the work-order inspection and the overall result', () => {
    const { html, prep } = compose('qc_checklist', PEOPLE.neil, recordedCtx('qc_checklist'));
    assert.equal(prep.data.result, 'failed');
    assert.equal((html.match(/☑/g) || []).length, 2 + 0, 'one pass tick, one N/A tick');
    assert.ok(html.includes('☒'), 'a fail cross');
    const t = text(html);
    for (const s of ['Welds ground smooth', 'Hood 4mm short', 'WO-2026-0007', 'FAILED', 'McArthur Sarabia', 'Re-cut the hood panel.']) assert.ok(t.includes(s), s);
    assert.ok(!t.includes('All welds ground smooth'), 'the recorded list replaces the house list');
    assert.equal(prep.signatures[0].name, 'McArthur Sarabia');
  });
  it('a tick whose label no longer matches the list at that index is ignored', () => {
    const p = recorded(); p.jobOrder.qcTicks[0].label = 'Something else';
    const { prep } = compose('qc_checklist', PEOPLE.rene, { project: p });
    assert.equal(prep.data.checks[0].state, '');
  });
  it('installation checklist: a recorded tick, date and initials print; notes print instead of ruled lines', () => {
    const { html } = compose('installation_checklist', PEOPLE.rene, recordedCtx('installation_checklist'));
    const t = text(html);
    assert.equal((html.match(/☑/g) || []).length, 1);
    for (const s of ['Units levelled', 'December 16, 2026', 'RP', 'Gas line not yet connected by client.']) assert.ok(t.includes(s), s);
  });
  it('punch list: recorded items, done tick, status line', () => {
    const { html } = compose('punch_list', PEOPLE.rene, recordedCtx('punch_list'));
    const t = text(html);
    for (const s of ['Scratch on sink front', 'Wash area', 'Loose shelf bracket', 'December 17, 2026', '1 of 2 item(s) still open.']) assert.ok(t.includes(s), s);
    assert.equal((html.match(/☑/g) || []).length, 1);
    const cleared = recorded(); cleared.punchList.items.forEach((x) => { x.done = true; }); cleared.punchList.clearedAt = '2026-12-19'; cleared.punchList.clearedBy = 'Rene Palles';
    assert.ok(text(compose('punch_list', PEOPLE.rene, { project: cleared }).html).includes('Punch list cleared on December 19, 2026 by Rene Palles.'));
    const arrayForm = JSON.parse(JSON.stringify(project)); arrayForm.punchList = [{ text: 'Loose door' }];
    assert.ok(text(compose('punch_list', PEOPLE.rene, { project: arrayForm }).html).includes('Loose door'));
  });
  it('client acceptance: blank has the statement and empty signing lines; recorded prints who accepted and when, and the punch-list position', () => {
    const blank = text(compose('client_acceptance', PEOPLE.rene).html);
    for (const s of ['Acceptance', 'are accepted in good order', 'No punch-list items are recorded.', 'To be attached', 'Conforme — Accepted by Client']) assert.ok(blank.includes(s), s);
    const rec = compose('client_acceptance', PEOPLE.neil, recordedCtx('client_acceptance'));
    const t = text(rec.html);
    for (const s of ['Maria Santos', 'December 18, 2026', 'On file', '1 of 2 punch-list item(s) are still open']) assert.ok(t.includes(s), s);
    assert.equal(rec.prep.dateIso, '2026-12-18');
  });
  it('escaping: markup in a note is escaped', () => {
    const p = JSON.parse(JSON.stringify(project)); p.punchList = { items: [{ text: '<img src=x onerror=alert(1)>' }] };
    const { html } = compose('punch_list', PEOPLE.rene, { project: p });
    assert.ok(!html.includes('<img src=x') && html.includes('&lt;img src=x'));
  });
});

describe('5. numbers and file names', () => {
  it('QC-/INS-/PL-/ACC- + the job order number, derived: a stored JO number, a revision never touches it', () => {
    const p = JSON.parse(JSON.stringify(project)); p.joNumber = 'JO-0012';
    const want = { qc_checklist: 'QC-JO-0012', installation_checklist: 'INS-JO-0012', punch_list: 'PL-JO-0012', client_acceptance: 'ACC-JO-0012' };
    for (const id of JOB_IDS) {
      const { prep } = compose(id, PEOPLE.rene, { project: p });
      assert.equal(prep.number, want[id]); assert.equal(prep.numberSource, 'derived'); assert.equal(prep.numberText, want[id]);
      assert.equal(prep.fileName, want[id] + '.pdf');
      assert.ok(text(compose(id, PEOPLE.rene, { project: p }).html).includes(want[id]), id + ' header shows its number');
    }
  });
  it('with no stored JO number the number follows the job order\'s fallback, still prefixed', () => {
    for (const [id, pre] of [['qc_checklist', 'QC-'], ['installation_checklist', 'INS-'], ['punch_list', 'PL-'], ['client_acceptance', 'ACC-']]) {
      const { prep } = compose(id, PEOPLE.rene); assert.ok(prep.number.startsWith(pre + 'JO-'), prep.number);
    }
  });
  it('assignWith writes nothing for these forms (no counters)', async () => {
    const wrote = [];
    const fake = { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }), runTransaction: async () => { wrote.push('tx'); } };
    const out = await FC.assignWith(fake, JOB_IDS, { projectId: 'x' }, PEOPLE.rene);
    assert.equal(wrote.length, 0); assert.ok(Object.keys(out).length === 4);
  });
  it('the delivery receipt keeps its stored DR serial; with none recorded it shows the work order\'s fallback', () => {
    const rec = compose('delivery_receipt', PEOPLE.rene, recordedCtx('delivery_receipt'));
    assert.equal(rec.prep.number, 'DR-2026-000042'); assert.equal(rec.prep.numberSource, 'stored'); assert.equal(rec.prep.fileName, 'DR-2026-000042.pdf');
    const blank = compose('delivery_receipt', PEOPLE.rene);
    assert.equal(blank.prep.numberSource, 'fallback'); assert.equal(blank.prep.number, 'DR-' + FC.last6('woAbCdEf9876'));
  });
});

describe('6. the Google-review QR', () => {
  it('client_acceptance carries a local QR (inline SVG, no network) and the one plain line, with the link', () => {
    const { html } = compose('client_acceptance', PEOPLE.rene);
    assert.ok(html.includes('class="review-qr"'));
    assert.ok(/<svg [^>]*>\s*<rect/.test(html.slice(html.indexOf('review-qr'))), 'an inline QR SVG');
    assert.ok(text(html).includes(REVIEW_LINE));
    assert.ok(html.includes(REVIEW_URL));
    assert.ok(html.indexOf('review-qr') < html.indexOf('class="print-footer"') && html.indexOf('review-qr') > html.indexOf('sig-row'), 'under the signatures, above the footer');
    assert.doesNotMatch(html, /<img[^>]+(chart\.googleapis|qrserver|api\.qr)/i, 'no remote image service');
    assert.doesNotMatch(html.slice(html.indexOf('review-qr')), /<svg[\s\S]*?(src|href)=["']https?:/i, 'the QR makes no request');
  });
  it('the encoder really encodes the link (a different link gives a different code)', () => {
    const a = window.buildQRSVG(REVIEW_URL, 84), b = window.buildQRSVG(REVIEW_URL + 'x', 84);
    assert.ok(a.startsWith('<svg') && a.length > 1000); assert.notEqual(a, b);
  });
  it('without the encoder the plain line and the link still print', () => {
    const keep = window.buildQRSVG; delete window.buildQRSVG;
    try { const { html } = compose('client_acceptance', PEOPLE.rene); assert.ok(text(html).includes(REVIEW_LINE) && html.includes(REVIEW_URL)); assert.ok(!html.includes('rq-code')); }
    finally { window.buildQRSVG = keep; }
  });
  it('no other of the five (and no Phase 1 form) renders the QR or the line', () => {
    for (const id of IDS.filter((x) => x !== 'client_acceptance')) {
      const { html } = compose(id, PEOPLE.rene);
      assert.ok(!html.includes('review-qr') && !text(html).includes(REVIEW_LINE) && !html.includes(REVIEW_URL), id);
    }
    for (const id of ['job_order', 'handoff_pack']) {
      const prep = FC.prepare(id, ctxOf('job_order', PEOPLE.neil)); assert.ok(prep.ok);
      assert.ok(!FC.compose(prep, FC.renderSections(prep)).bodyHtml.includes('review-qr'), id);
    }
  });
});

describe('7. the delivery receipt matches the print it replaces (production.js printDeliveryReceipt)', () => {
  const old = read('js/screens/production.js');
  const src = old.slice(old.indexOf('function printDeliveryReceipt('), old.indexOf('// PROJECT LIFECYCLE'));
  it('the old print\'s content is all there: title, DR no., date, Work Order / Quote meta, Deliver To, Work Order box, # / Description / Qty with the line and three blank rows, notes, Delivered by / Received by (client)', () => {
    for (const s of ["docTitle: 'DELIVERY RECEIPT'", "'Work Order: '", "'Quote: '", "label: 'Delivered by'", "label: 'Received by (client)'", 'Deliver To', '<th style="width:32px">#</th><th>Description</th><th style="width:80px">Qty</th>', 'k < 4']) assert.ok(src.includes(s), 'old print still has ' + s);
    const { html, prep } = compose('delivery_receipt', PEOPLE.rene, recordedCtx('delivery_receipt'));
    const t = text(html);
    assert.equal(prep.title, 'DELIVERY RECEIPT');
    for (const s of ['DELIVERY RECEIPT', 'DR-2026-000042', 'December 15, 2026', 'Work Order: WO-2026-0007', 'Quote: BKMLFB260730-001R3', 'DELIVER TO', 'Mamitas Bulaluhan',
      'Work Order', 'Canopy hood 2400 mm', 'Notes', 'One box dented on arrival', 'Delivered by', 'Rene Palles', 'Production — Barro Industries', 'Received by (client)', 'Maria Santos']) assert.ok(t.includes(s), s);
    assert.match(html, /<th class="ac">#<\/th><th class="">Description<\/th><th class="ac">Qty<\/th>/);
    const rows = html.match(/<tr class="blank">/g) || [];
    assert.equal(rows.length, 3, 'three blank rows');
    for (const n of ['2', '3', '4']) assert.ok(new RegExp(`<tr class="blank"><td class="ac">${n}</td>`).test(html), 'blank row ' + n);
    assert.ok(/<td class="ac">1<\/td><td class="">Canopy hood 2400 mm<\/td><td class="ac">3<\/td>/.test(html), 'the work order line: 1 / title / qty');
  });
  it('a work order with no receipt yet still prints a blank receipt; no Notes section without notes', () => {
    const { html } = compose('delivery_receipt', PEOPLE.neil);
    assert.ok(text(html).includes('Canopy hood 2400 mm') && text(html).includes('Received by (client)'));
    assert.ok(!text(html).includes('Notes'));
  });
  it('the company follows the record: a Barro Kitchens project gets the BK header, others the Barro Industries one', () => {
    assert.ok(compose('delivery_receipt', PEOPLE.rene).html.includes('BARRO KITCHENS'));
    const wo = workOrder();
    const prep = FC.prepare('delivery_receipt', { order: wo, today: '2026-11-20', viewer: PEOPLE.rene });
    assert.equal(prep.company, 'BI');
  });
});

describe('no form ever prints a JavaScript object as text', () => {
  it('blank and recorded, every stage form, has no "[object Object]" and no "undefined"', () => {
    for (const id of IDS) {
      for (const extra of [undefined, (recordedCtx(id, PEOPLE.rene) || {})]) {
        const prep = FC.prepare(id, Object.assign(ctxOf(id, PEOPLE.rene), extra || {}));
        assert.ok(prep.ok, id + ': ' + (prep.error || ''));
        const html = FC.compose(prep, FC.renderSections(prep)).bodyHtml;
        assert.ok(!/\[object Object\]/.test(html), id + ' prints [object Object]');
        assert.ok(!/>\s*undefined\s*</.test(html), id + ' prints undefined');
      }
    }
  });
});
