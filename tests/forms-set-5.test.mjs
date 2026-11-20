// tests/forms-set-5.test.mjs — Phase 5 forms on the forms engine (specs/SALES-FLOW-SPEC-2026-11-19.md §5.6, §5.7, §9.9, §9.10):
//   site_visit_request (SITE VISIT REQUEST AND FEE ACKNOWLEDGEMENT, sales, pesos)   change_order (CHANGE ORDER, sales, pesos)   site_visit_report (SITE VISIT REPORT, ops, NO pesos)
//
// WHAT IT PINS
//   1. REGISTRY  titles, audiences, body sets (the two money forms in js/forms-set-5.js; the ops report in js/forms-set-2.js, where the file-wide peso scan covers it),
//                the report registers no money field, money forms need js/flow-core.js, none of the titles is a banned one.
//   2. AUDIENCE  the two money forms open for Sales, the books tier and the President — never for Production or a login with no role; the report opens for every staff login.
//   3. RECORDS   a form's own doc is read by ref.docId (or preloaded); what hangs off it (the fee claim; the order, job and request) is read softly; a missing doc is not-found.
//   4. SITE VISIT REQUEST  the tariff by area; the fee acknowledgement part appears ONLY once the fee claim is recorded; signatures P, C — and A once confirmed
//                (for the President when a stand-in confirmed); the number is the stored SV- serial or the last-6 fallback.
//   5. CHANGE ORDER  lines grouped Added / Removed with signed amounts; price difference; added down payment; the new contract amount = current + price,
//                and never the price twice once it has been applied; the signer for Barro and the client's.
//   7. THROUGH window.Forms  the REAL js/forms.js with a fake Firestore: Forms.open / buttonHtml by docId load the visit, its fee claim, the client; the change order, its order, job and request;
//                each body set loads on first use; an Operations login gets no button for a money form and an 'access' error if it forces one.
//   6. THE WALL  site_visit_report carries no peso for ANY login, blank or filled; a price typed into it is refused, not printed; a visit doc that somehow holds a fee
//                never reaches it (only declared fields are copied); h.peso() throws on it; its body file has no peso formatter.
// Mutation-checked in a scratch copy (see the hand-back).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { read, setupForms, PEOPLE, jobOrderHelpersSource } from './fixtures/forms-env.mjs';

const require = createRequire(import.meta.url);
const { createFake } = require('./fixtures/fake-firestore.cjs');
const FC = setupForms();
require('../js/flow-core.js');
require('../js/forms-set-2.js');
require('../js/forms-set-5.js');

const clone = (v) => JSON.parse(JSON.stringify(v));
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const LOGINS = Object.entries(PEOPLE).filter(([k]) => k !== 'nobody');
const SALES_SIDE = ['neil', 'manager', 'shairaRole', 'shaira', 'uriel'];
const OPS_SIDE = ['rene', 'mcarthur', 'designer'];
const ts = (iso) => ({ toDate: () => new Date(iso), seconds: Math.floor(new Date(iso).getTime() / 1000) });

const client = { id: 'cli1', name: 'Mamitas Bulaluhan', company: 'Mamitas Food Corp.', address: '12 Aurora Blvd., Quezon City', phone: '0917 123 4567', email: 'mamitas@example.com' };
const visit = (o = {}) => ({ id: 'svAbCdEf1234', svNumber: 'SV-0009', clientId: 'cli1', clientName: 'Mamitas Bulaluhan', company: 'BK', quoteId: 'q1', quoteNumber: 'BKMLFB260730-001R1', area: 'near',
  requestedDate: '2026-11-25', visitDate: '2026-11-26', address: '12 Aurora Blvd., Quezon City', contactPerson: 'Maria Santos', contactPhone: '0917 123 4567', notes: 'Gate code is with the guard',
  status: 'fee_pending', feeClaimId: 'claim1', report: null, requestedBy: 'u-uri', requestedByName: 'Uriel Sagaoinit', requestedAt: ts('2026-11-20T02:00:00Z'), ...o });
const claim = (o = {}) => ({ id: 'claim1', kind: 'site_visit', siteVisitId: 'svAbCdEf1234', clientId: 'cli1', clientName: 'Mamitas Bulaluhan', area: 'near', status: 'recorded', paymentReceived: 2500, recordedAmount: 2500,
  paymentMethod: 'GCash', orRef: 'GC-5521', paymentDate: '2026-11-21', paNumber: 'PA-0044', recordedBy: 'Shaira Tecag', createdByName: 'Uriel Sagaoinit',
  paymentConfirm: { decision: 'confirmed', decidedByName: 'Neil Barro', decidedByRole: 'president', decidedAt: '2026-11-21T03:00:00Z', onBehalf: false }, ...o });
const report = (o = {}) => ({ measurements: 'Wall A 3,200 mm; ceiling 2,700 mm', constraints: 'Gas line on the east wall; door is 800 mm wide', layoutNotes: 'Put the hood on wall A',
  photos: [{ url: 'https://x.test/1.jpg', name: '1.jpg' }, { url: 'https://x.test/2.jpg', name: '2.jpg' }], attachments: [{ url: 'https://x.test/sketch.pdf', name: 'sketch.pdf' }], by: 'u-ren', byName: 'Rene Palles', at: '2026-11-26T08:00:00Z', ...o });

const order = (o = {}) => ({ id: 'ordAbCdEf123456', company: 'BK', clientId: 'cli1', clientName: 'Mamitas Bulaluhan', projectId: 'projXyz1', quoteNumber: 'BKMLFB260730-001R1', soNumber: 'SO-0012', contractAmount: 150000, status: 'recorded', createdBy: 'u-uri', ...o });
const project = (o = {}) => ({ id: 'projXyz1', clientName: 'Mamitas Bulaluhan', joNumber: 'JO-0012', salesOrderId: 'ordAbCdEf123456', ...o });
const request = (o = {}) => ({ id: 'cr1', projectId: 'projXyz1', clientName: 'Mamitas Bulaluhan', details: 'Client wants a shelf under the canopy hood and one fewer work table', effectOnDeadlineDays: 3, status: 'priced', ...o });
const co = (o = {}) => ({ id: 'cr1', orderId: 'ordAbCdEf123456', projectId: 'projXyz1', coNumber: 'CO-0004', status: 'priced', pricedByName: 'Uriel Sagaoinit', pricedBy: 'u-uri', pricedAt: '2026-11-22T02:00:00Z',
  pricing: { lines: [{ kind: 'added', name: 'Undershelf', qty: 2, unit: 'pc', unitPrice: 4500, std: null }, { kind: 'removed', name: 'Work table', qty: 1, unit: 'pc', unitPrice: 20000, std: null }], price: -11000, addedDownPayment: 0 }, ...o });
const coUp = (o = {}) => co({ pricing: { lines: [{ kind: 'added', name: 'Undershelf', qty: 2, unit: 'pc', unitPrice: 4500 }, { kind: 'added', name: 'Pot rack', qty: 1, unit: 'pc', unitPrice: 6000 }, { kind: 'removed', name: 'Work table', qty: 1, unit: 'pc', unitPrice: 1000 }], price: 14000, addedDownPayment: 7000 }, ...o });

const ctxOf = (id, viewer, extra) => {
  const base = { today: '2026-11-22', client, viewer };
  if (id === 'change_order') return { ...base, changeOrder: co(), changeRequest: request(), order: order(), project: project(), ...extra };
  return { ...base, visit: visit(), claim: claim(), ...extra };
};
const compose = (id, viewer, extra) => {
  const prep = FC.prepare(id, ctxOf(id, viewer, extra));
  assert.ok(prep.ok, id + ': ' + (prep.error || ''));
  const page = FC.compose(prep, FC.renderSections(prep));
  return { prep, page, html: page.bodyHtml, t: text(page.bodyHtml) };
};

describe('1. the registry', () => {
  it('three entries with the spec\'s titles and audiences; the portrait page; the body sets', () => {
    const got = Object.fromEntries(['site_visit_request', 'change_order', 'site_visit_report'].map((id) => [id, [FC.get(id).title, FC.get(id).audience, FC.get(id).bodySet, FC.get(id).orientation]]));
    assert.deepEqual(got, {
      site_visit_request: ['SITE VISIT REQUEST AND FEE ACKNOWLEDGEMENT', 'sales', 'js/forms-set-5.js', 'portrait'],
      change_order: ['CHANGE ORDER', 'sales', 'js/forms-set-5.js', 'portrait'],
      site_visit_report: ['SITE VISIT REPORT', 'ops', 'js/forms-set-2.js', 'portrait'],
    });
  });
  it('the report is an Operations form with no money field at all; the two Sales forms declare their money fields', () => {
    for (const f of FC.get('site_visit_report').fields) { assert.ok(!f.money, f.key); assert.doesNotMatch(f.key, FC.PESO_KEY, `${f.key} is a price-like name`); }
    assert.ok(FC.get('site_visit_request').fields.some((f) => f.money), 'the tariff and the fee received are money');
    assert.deepEqual(FC.get('change_order').fields.filter((f) => f.money).map((f) => f.key), ['lines', 'price', 'addedDownPayment', 'contractBefore', 'contractAfter']);
  });
  it('all three need js/flow-core.js (the tariff, the area words and the change-order totals live there, once); each names its own doc', () => {
    for (const id of ['site_visit_request', 'change_order', 'site_visit_report']) assert.deepEqual(FC.get(id).needs, ['js/flow-core.js'], id);
    assert.deepEqual(['site_visit_request', 'site_visit_report', 'change_order'].map((id) => FC.get(id).docKey), ['visit', 'visit', 'changeOrder']);
    assert.equal(FC.get('site_visit_request').source.coll, 'site_visits'); assert.equal(FC.get('change_order').source.coll, 'change_orders');
  });
  it('no title is a banned one, and registering an ops form with a money field is still refused', () => {
    for (const id of ['site_visit_request', 'change_order', 'site_visit_report']) assert.equal(FC.assertTitleAllowed(FC.get(id).title), true);
    assert.throws(() => FC.register({ id: 't_ops', title: 'TEST', audience: 'ops', fields: [{ key: 'x', money: true }] }), (e) => e.code === 'ops-money-field');
  });
  it('the numbers: SV- (request, acknowledgement and report share it) and CO-, with the last-6 fallback', () => {
    assert.equal(FC.get('site_visit_request').number.series, 'SV'); assert.equal(FC.get('site_visit_report').number.series, 'SV'); assert.equal(FC.get('change_order').number.series, 'CO');
    assert.equal(FC.get('site_visit_request').number.field, 'svNumber'); assert.equal(FC.get('change_order').number.field, 'coNumber');
    assert.equal(FC.counterName('SV'), 'form_SV'); assert.equal(FC.counterName('CO'), 'form_CO');
  });
});

describe('2. audience', () => {
  for (const id of ['site_visit_request', 'change_order']) {
    it(`${id}: Sales, the books tier and the President open it; Production, Design and a login with no role do not`, () => {
      for (const k of SALES_SIDE) assert.equal(FC.canOpen(id, PEOPLE[k]), true, k);
      for (const k of OPS_SIDE) assert.equal(FC.canOpen(id, PEOPLE[k]), false, k);
      assert.equal(FC.canOpen(id, PEOPLE.nobody), false);
      const refused = FC.prepare(id, ctxOf(id, PEOPLE.rene));
      assert.equal(refused.ok, false); assert.equal(refused.code, 'not-allowed');
    });
  }
  it('site_visit_report: every staff login opens it (the Operations audience); a login with no role does not', () => {
    for (const [k, v] of LOGINS) assert.equal(FC.canOpen('site_visit_report', v), true, k);
    assert.equal(FC.canOpen('site_visit_report', PEOPLE.nobody), false);
  });
  it('a missing record is refused with a plain message', () => {
    assert.equal(FC.prepare('site_visit_request', { viewer: PEOPLE.uriel, today: '2026-11-22' }).error, 'We could not find that site visit.');
    assert.equal(FC.prepare('site_visit_report', { viewer: PEOPLE.rene, today: '2026-11-22' }).error, 'We could not find that site visit.');
    assert.equal(FC.prepare('change_order', { viewer: PEOPLE.uriel, today: '2026-11-22' }).error, 'We could not find that change order.');
  });
});

describe('3. records: a form\'s own doc is read by ref.docId, the rest softly', () => {
  const seed = (fake) => {
    fake.seed('site_visits/svAbCdEf1234', visit()); fake.seed('payment_claims/claim1', claim());
    fake.seed('change_orders/cr1', co()); fake.seed('change_requests/cr1', request()); fake.seed('sales_orders/ordAbCdEf123456', order()); fake.seed('job_projects/projXyz1', project());
  };
  it('a site visit by docId brings its fee claim; a change order by docId brings its order, job and request', async () => {
    const fake = createFake(); seed(fake);
    const v = await FC.loadRecords(fake.db, FC.get('site_visit_request'), { docId: 'svAbCdEf1234' });
    assert.equal(v.extra.visit.id, 'svAbCdEf1234'); assert.equal(v.claim.id, 'claim1'); assert.equal(v.order, null);
    const c = await FC.loadRecords(fake.db, FC.get('change_order'), { docId: 'cr1' });
    assert.equal(c.extra.changeOrder.id, 'cr1'); assert.equal(c.order.id, 'ordAbCdEf123456'); assert.equal(c.project.id, 'projXyz1'); assert.equal(c.extra.changeRequest.id, 'cr1');
  });
  it('the report reads the visit only (no claim: it is an Operations form and a fee has no place on it)', async () => {
    const fake = createFake(); seed(fake);
    const r = await FC.loadRecords(fake.db, FC.get('site_visit_report'), { docId: 'svAbCdEf1234' });
    assert.equal(r.extra.visit.id, 'svAbCdEf1234'); assert.equal(r.claim, null);
    assert.equal(Object.keys(fake.stats.docGets).filter((k) => k.startsWith('payment_claims')).length, 0, 'the payment_claims collection is never read for the report');
  });
  it('a preloaded record is used with no read; a missing doc is not-found; a related doc that cannot be read leaves that part out', async () => {
    const fake = createFake();
    const pre = await FC.loadRecords(null, FC.get('site_visit_report'), { record: visit() });
    assert.equal(pre.extra.visit.id, 'svAbCdEf1234');
    await assert.rejects(FC.loadRecords(fake.db, FC.get('site_visit_request'), { docId: 'nope' }), (e) => e.code === 'not-found');
    await assert.rejects(FC.loadRecords(fake.db, FC.get('change_order'), {}), (e) => e.code === 'not-found');
    fake.seed('site_visits/svAbCdEf1234', visit());                              // its claim doc does not exist
    const soft = await FC.loadRecords(fake.db, FC.get('site_visit_request'), { docId: 'svAbCdEf1234' });
    assert.equal(soft.claim, null);
  });
  it('entries without docKey are untouched: a sales order is still loaded the old way', async () => {
    const fake = createFake(); fake.seed('sales_orders/ordAbCdEf123456', order()); fake.seed('job_projects/projXyz1', project());
    const so = await FC.loadRecords(fake.db, FC.get('sales_order'), { orderId: 'ordAbCdEf123456' });
    assert.equal(so.order.id, 'ordAbCdEf123456'); assert.equal(so.project.id, 'projXyz1'); assert.equal(so.extra, undefined);
  });
});

describe('4. site_visit_request: the tariff, and the fee acknowledgement only once the fee is confirmed', () => {
  it('shows the tariff for the area on the fee line (₱1,000 / ₱2,500 / ₱5,000)', () => {
    for (const [area, label, fee] of [['mm', 'Metro Manila', '₱1,000'], ['near', 'Nearby provinces', '₱2,500'], ['far', 'Far Luzon', '₱5,000']]) {
      const { t } = compose('site_visit_request', PEOPLE.uriel, { visit: visit({ area, status: 'requested', feeClaimId: null }), claim: null });
      assert.ok(t.includes(`Fee for ${label} ${fee}`), area + ': ' + t.slice(0, 600));
    }
  });
  it('before the fee is recorded there is NO acknowledgement part and only two signature boxes (Prepared by, Client conforme)', () => {
    for (const c of [null, claim({ status: 'pending', recordedAmount: undefined, paNumber: undefined }), claim({ status: 'payment_rejected' })]) {
      const { t, prep } = compose('site_visit_request', PEOPLE.uriel, { claim: c });
      assert.ok(!t.includes('Fee Acknowledgement') && !t.includes('Amount Received') && !t.includes('PA-0044'), JSON.stringify(c && c.status));
      assert.deepEqual(prep.signatures.map((s) => s.role), ['Prepared by', 'Client conforme']);
      assert.ok(t.includes('₱2,500'), 'the tariff still shows');
    }
  });
  it('a claim that belongs to another visit is not this visit\'s fee', () => {
    const { t } = compose('site_visit_request', PEOPLE.uriel, { claim: claim({ siteVisitId: 'someOtherVisit' }) });
    assert.ok(!t.includes('Fee Acknowledgement'));
  });
  it('once the claim is recorded: the amount received, the method, the reference, the date, the PA number and the confirmer, and three signature boxes', () => {
    const { t, prep } = compose('site_visit_request', PEOPLE.uriel);
    for (const want of ['Fee Acknowledgement', 'Amount Received ₱2,500', 'GCash', 'GC-5521', 'November 21, 2026', 'PA-0044', 'This is not an official receipt. The BIR official receipt is issued separately by Finance.']) assert.ok(t.includes(want), want);
    assert.deepEqual(prep.signatures.map((s) => s.role), ['Prepared by', 'Confirmed by', 'Client conforme']);
    assert.equal(prep.signatures[0].name, 'Uriel Sagaoinit'); assert.equal(prep.signatures[1].name, 'Neil Barro');
    assert.deepEqual(prep.signatures[1].lines, ['President', 'Confirmed November 21, 2026']);
  });
  it('a stand-in\'s confirmation says so: "Finance, for the President"', () => {
    const { prep } = compose('site_visit_request', PEOPLE.uriel, { claim: claim({ paymentConfirm: { decision: 'confirmed', decidedByName: 'Shaira Tecag', decidedByRole: 'finance', decidedAt: '2026-11-21T03:00:00Z', onBehalf: true } }) });
    assert.equal(prep.signatures[1].name, 'Shaira Tecag'); assert.equal(prep.signatures[1].lines[0], 'Finance, for the President');
  });
  it('the number is the stored SV- serial (with the title, file name and header), else SV- + the last six characters of the id', () => {
    const a = compose('site_visit_request', PEOPLE.uriel);
    assert.equal(a.prep.number, 'SV-0009'); assert.equal(a.prep.fileName, 'SV-0009.pdf'); assert.ok(a.html.includes('<div class="fh-no">SV-0009</div>'));
    assert.ok(a.html.includes('SITE VISIT REQUEST AND FEE ACKNOWLEDGEMENT'));
    const b = compose('site_visit_request', PEOPLE.uriel, { visit: visit({ svNumber: undefined }) });
    assert.equal(b.prep.number, 'SV-CDEF1234'.slice(0, 3) + 'EF1234'); assert.equal(b.prep.numberSource, 'fallback');
  });
  it('the header carries the quotation ref and the visit date; the client strip carries the client; the notes print', () => {
    const { t } = compose('site_visit_request', PEOPLE.uriel);
    for (const want of ['Quotation ref: BKMLFB260730-001R1', 'Visit date: November 26, 2026', 'Mamitas Bulaluhan', 'Mamitas Food Corp.', 'Gate code is with the guard', 'Maria Santos · 0917 123 4567', '12 Aurora Blvd., Quezon City']) assert.ok(t.includes(want), want);
  });
  it('a price typed into the notes does not matter to a Sales form (it is not an Operations form) — and no ops-only wording leaks in', () => {
    const { t } = compose('site_visit_request', PEOPLE.uriel, { visit: visit({ notes: 'client says ₱500 only' }) });
    assert.ok(t.includes('₱500'));
  });
  it('a site-visit form is never the Barro Kitchens header unless the visit\'s company is BK; Brilliant Steel uses the Barro Industries header', () => {
    assert.ok(compose('site_visit_request', PEOPLE.uriel, { visit: visit({ company: 'BK' }) }).html.includes('BARRO KITCHENS'));
    const bi = compose('site_visit_request', PEOPLE.uriel, { visit: visit({ company: 'BI' }) });
    assert.ok(!bi.html.includes('class="fh-brand"'));
    assert.ok(!compose('site_visit_request', PEOPLE.uriel, { visit: visit({ company: 'BS' }) }).html.includes('class="fh-brand"'));
  });
});

describe('5. change_order: the lines, the price difference, the added down payment, the new contract amount', () => {
  it('lists ADDED lines then REMOVED lines with signed amounts, and prices the difference', () => {
    const { t, html } = compose('change_order', PEOPLE.uriel, { changeOrder: coUp() });
    assert.ok(html.indexOf('>Added<') > 0 && html.indexOf('>Removed<') > html.indexOf('>Added<'));
    for (const want of ['Undershelf', '+₱9,000', 'Pot rack', '+₱6,000', 'Work table', '−₱1,000', 'This Change Order +₱14,000']) assert.ok(t.includes(want), want + ' :: ' + t.slice(0, 900));
  });
  it('the new contract amount is the current contract amount + the price (150,000 + 14,000 = 164,000), and a negative price lowers it', () => {
    const up = compose('change_order', PEOPLE.uriel, { changeOrder: coUp() });
    for (const want of ['Current Contract Amount ₱150,000', 'NEW CONTRACT AMOUNT ₱164,000']) assert.ok(up.t.includes(want), want);
    const down = compose('change_order', PEOPLE.uriel);
    for (const want of ['This Change Order −₱11,000', 'NEW CONTRACT AMOUNT ₱139,000']) assert.ok(down.t.includes(want), want);
  });
  it('once APPLIED the contract already holds the price: the revision\'s own figures print, the price is never counted twice', () => {
    const applied = compose('change_order', PEOPLE.uriel, { changeOrder: coUp({ status: 'applied', appliedContractRev: 1 }),
      order: order({ contractAmount: 164000, contractRev: 1, revisions: [{ revNo: 1, changeOrderId: 'cr1', fromAmount: 150000, toAmount: 164000, delta: 14000 }] }) });
    for (const want of ['Current Contract Amount ₱150,000', 'NEW CONTRACT AMOUNT ₱164,000', 'Applied to the contract as revision R1.']) assert.ok(applied.t.includes(want), want);
    assert.ok(!applied.t.includes('₱178,000'), 'not 164,000 + 14,000');
  });
  it('the added down payment prints; no down payment says None; the effect on the deadline prints', () => {
    const up = compose('change_order', PEOPLE.uriel, { changeOrder: coUp() });
    assert.ok(up.t.includes('Added Down Payment — due before work on the change starts ₱7,000'));
    assert.ok(up.t.includes('Effect on the Deadline +3 calendar days')); assert.ok(up.t.includes('Client wants a shelf under the canopy hood'));
    const none = compose('change_order', PEOPLE.uriel);
    assert.ok(none.t.includes('Added Down Payment — due before work on the change starts None'));
  });
  it('the signatures: Prepared by the person who priced it, Approved by whoever signed for Barro (blank until then), the client conforme', () => {
    const open = compose('change_order', PEOPLE.uriel).prep.signatures;
    assert.deepEqual(open.map((s) => [s.role, s.name]), [['Prepared by', 'Uriel Sagaoinit'], ['Reviewed & Approved by', ''], ['Client conforme', 'Mamitas Bulaluhan']]);
    const signed = compose('change_order', PEOPLE.uriel, { changeOrder: co({ status: 'signed', signed: { clientSignedBy: 'Maria Santos', date: '2026-11-23', signedForBarroBy: 'Neil Barro', signedForBarroRole: 'President' } }) }).prep.signatures;
    assert.deepEqual(signed.map((s) => s.name), ['Uriel Sagaoinit', 'Neil Barro', 'Maria Santos']);
    assert.equal(signed[1].lines[0], 'President'); assert.ok(signed[2].lines[1].includes('November 23, 2026'));
  });
  it('the number is the stored CO- serial, else CO- + the last six; the header carries the quotation and sales-order refs', () => {
    const a = compose('change_order', PEOPLE.uriel);
    assert.equal(a.prep.number, 'CO-0004'); assert.equal(a.prep.fileName, 'CO-0004.pdf');
    for (const want of ['Quotation ref: BKMLFB260730-001R1', 'Sales order ref: SO-0012']) assert.ok(a.prep.extraMeta.includes(want) || a.t.includes(want), want);
    assert.equal(compose('change_order', PEOPLE.uriel, { changeOrder: co({ coNumber: undefined, id: 'abcdef123456' }) }).prep.number, 'CO-123456');
  });
  it('a change order with no lines says so rather than printing an empty table', () => {
    const { t } = compose('change_order', PEOPLE.uriel, { changeOrder: co({ pricing: { lines: [], price: 0, addedDownPayment: 0 } }) });
    assert.ok(t.includes('No lines are priced on this change order yet.'));
  });
  it('the terms say it takes effect once both parties have signed and the added down payment is received', () => {
    const { t } = compose('change_order', PEOPLE.uriel);
    assert.ok(t.includes('both parties have signed it and the added down payment, if any, is received'));
  });
  it('plain words only: no "Rev." (the R style), no "Official Receipt" / "Sales Invoice" in any title', () => {
    for (const [id, extra] of [['change_order', undefined], ['site_visit_request', undefined], ['site_visit_report', undefined]]) {
      const { t } = compose(id, PEOPLE.uriel, extra);
      assert.doesNotMatch(t, /Rev\./); assert.doesNotMatch(FC.get(id).title, /official receipt|sales invoice/i);
    }
  });
});

describe('6. the peso wall: the report has no peso for any login', () => {
  const filled = () => ({ visit: visit({ status: 'done', report: report() }) });
  it('blank and filled, for every login, the page and its data carry no peso, no PHP and no price-like key', () => {
    for (const [k, v] of LOGINS) {
      for (const extra of [{ claim: null }, filled(), { visit: visit({ report: report() }), claim: claim() }]) {
        const { html, prep } = compose('site_visit_report', v, extra);
        assert.ok(!html.includes('₱'), `the report prints a peso for ${k}`);
        assert.doesNotMatch(html, /\bPHP\b|\bPhp\b/, k);
        assert.doesNotMatch(JSON.stringify(prep.data), /fee|amount|2500|price|paNumber|recordedAmount|paymentReceived|GCash|GC-5521/i, `the report data holds a money key or value (${k})`);
      }
    }
  });
  it('a visit doc that somehow carries a fee, an amount or a claim never reaches the report (only declared fields are copied)', () => {
    const { html, prep } = compose('site_visit_report', PEOPLE.rene, { visit: visit({ fee: 5000, amount: 999, paymentReceived: 5000, recordedAmount: 5000, feeClaimId: 'claim1', report: report() }), claim: claim() });
    assert.ok(!/5000|5,000|999/.test(html) && !/5000|999/.test(JSON.stringify(prep.data)));
    assert.deepEqual(Object.keys(prep.data).filter((k) => FC.PESO_KEY.test(k)), []);
  });
  it('a price typed into the report is refused with the plain message, not printed', () => {
    for (const k of ['measurements', 'constraints', 'layoutNotes']) {
      const prep = FC.prepare('site_visit_report', ctxOf('site_visit_report', PEOPLE.rene, { visit: visit({ report: report({ [k]: 'Pay ₱5,000 for the hood' }) }) }));
      assert.equal(prep.ok, false, k); assert.equal(prep.code, 'peso-in-text', k); assert.equal(prep.error, FC.PESO_IN_TEXT_MESSAGE, k);
    }
    const sneaky = FC.prepare('site_visit_report', ctxOf('site_visit_report', PEOPLE.rene, { visit: visit({ address: 'PHP 5 Street', report: report() }) }));
    assert.equal(sneaky.ok, false, 'the address field is scanned too');
  });
  it('h.peso() throws on the report; its body file has no peso formatter or sign (the same scan forms-set-2.test.mjs runs over the whole file)', () => {
    assert.throws(() => FC.makeHelpers(FC.get('site_visit_report')).peso(5), (e) => e.code === 'peso-on-ops');
    const code = read('js/forms-set-2.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(code.includes('bodies.site_visit_report'), 'the report body is in the scanned file');
    for (const bad of [/₱/, /\bh\.peso\b/, /\bmoney\s*\(/, /\bfmtN?2?\s*\(/, /\bPHP\b|\bPhp\b/, /toLocaleString\(/, /Intl\.NumberFormat/, /\bpesos?\b/i]) assert.doesNotMatch(code, bad, String(bad));
  });
  it('the report is identical for every viewer (no "show pesos if Neil is looking" branch)', () => {
    const a = compose('site_visit_report', PEOPLE.rene, filled()).html, b = compose('site_visit_report', PEOPLE.neil, filled()).html;
    assert.equal(a, b);
  });
  it('blank: a visit with no report yet prints a fillable paper form (ruled lines for the three notes)', () => {
    const { html, t } = compose('site_visit_report', PEOPLE.rene, { claim: null });
    for (const want of ['Measurements', 'Site Constraints', 'Layout Notes', 'No photos on file.', 'No attachments.']) assert.ok(t.includes(want), want);
    assert.ok((html.match(/border-bottom:1px solid #999;height:19px/g) || []).length >= 12, 'ruled lines for the three notes');
  });
  it('filled: the notes, the number of photos, the attachment names (never their links), who wrote it and when; signatures Prepared by (Rene) and Checked by', () => {
    const { t, html, prep } = compose('site_visit_report', PEOPLE.rene, filled());
    for (const want of ['Wall A 3,200 mm', 'Gas line on the east wall', 'Put the hood on wall A', '2 photos on file.', 'Attachments: sketch.pdf.', 'Rene Palles on November 26, 2026', 'Maria Santos · 0917 123 4567', 'SV-0009']) assert.ok(t.includes(want), want);
    assert.ok(!html.includes('https://x.test'), 'no file link is printed');
    assert.deepEqual(prep.signatures.map((s) => [s.role, s.name]), [['Prepared by', 'Rene Palles'], ['Checked by', '']]);
    assert.equal(prep.fileName, 'SV-0009.pdf');
  });
  it('no commercial wording on the report: no fee, no tariff, no paid, no PA number', () => {
    const { t } = compose('site_visit_report', PEOPLE.rene, { visit: visit({ report: report() }), claim: claim() });
    assert.doesNotMatch(t, /\bfee\b|tariff|\bpaid\b|PA-0044|acknowledg|official receipt/i);
  });
});

// ── 7. through the real js/forms.js (loadCtx copies a form's own doc and what hangs off it) ────────────────────────────────────────
function makeApp(person, db) {
  const log = { loaded: [], open: [], toasts: [] };
  const box = { console };
  box.window = box; vm.createContext(box);
  const panel = { querySelector: () => null };
  Object.assign(box, {
    db, currentRole: person.role, currentDepts: person.depts, currentUser: { uid: person.uid, email: 'user@example.com' }, userProfile: { displayName: person.name, role: person.role, departments: person.depts },
    bizDate: () => '2026-11-22', Notifs: { showToast: (m, t) => log.toasts.push([m, t]) }, openModal() {}, document: { querySelector: () => null },
    openPrintableDoc: (o) => { log.open.push(o); return panel; }, exportPrintableDocPdf: async (o) => ({ ok: true, fileName: o.fileName }),
    nextCounterId: async (name, seed, f) => f(1), busy: (b, fn) => fn(), setTimeout,
  });
  const loaded = new Map();
  box.ensureScript = (src) => {
    if (!loaded.has(src)) { log.loaded.push(src); loaded.set(src, Promise.resolve().then(() => { vm.runInContext(src === 'js/screens/production.js' ? jobOrderHelpersSource() : read(src), box, { filename: src }); })); }
    return loaded.get(src);
  };
  const flowForms = () => box.ensureScript('js/forms.js').then(() => box.Forms);
  return { box, log, flowForms };
}
const world = () => {
  const fake = createFake();
  fake.seed('site_visits/svAbCdEf1234', visit({ report: report(), status: 'done' })); fake.seed('payment_claims/claim1', claim()); fake.seed('clients/cli1', client);
  fake.seed('change_orders/cr1', coUp()); fake.seed('change_requests/cr1', request()); fake.seed('sales_orders/ordAbCdEf123456', order()); fake.seed('job_projects/projXyz1', project()); fake.seed('clients/cli1', client);
  return fake;
};

describe('7. through window.Forms (the real forms.js, a fake Firestore)', () => {
  it('Forms.open a site visit request by docId: the visit, its confirmed fee claim and the client are read; the Sales body set and flow-core load on first use', async () => {
    const app = makeApp(PEOPLE.uriel, world().db); const F = await app.flowForms();
    const res = await F.open('site_visit_request', { docId: 'svAbCdEf1234' });
    assert.equal(res.ok, true, res.error); assert.equal(res.number, 'SV-0009'); assert.equal(res.fileName, 'SV-0009.pdf');
    const t = text(app.log.open[0].bodyHtml);
    for (const want of ['SITE VISIT REQUEST AND FEE ACKNOWLEDGEMENT', 'Fee for Nearby provinces ₱2,500', 'Fee Acknowledgement', 'PA-0044', 'Mamitas Food Corp.', '12 Aurora Blvd., Quezon City']) assert.ok(t.includes(want), want);
    assert.ok(app.log.loaded.includes('js/forms-set-5.js') && app.log.loaded.includes('js/flow-core.js'), app.log.loaded.join(','));
    assert.equal(app.log.open[0].downloadPdf, true);
  });
  it('Forms.open the change order by docId: its sales order, job and request are read, so the contract amounts and the details print', async () => {
    const app = makeApp(PEOPLE.uriel, world().db); const F = await app.flowForms();
    const res = await F.open('change_order', { docId: 'cr1', orderId: 'ordAbCdEf123456', projectId: 'projXyz1' });
    assert.equal(res.ok, true, res.error); assert.equal(res.number, 'CO-0004');
    const t = text(app.log.open[0].bodyHtml);
    for (const want of ['CHANGE ORDER', 'Current Contract Amount ₱150,000', 'NEW CONTRACT AMOUNT ₱164,000', 'Client wants a shelf under the canopy hood', 'Sales order ref: SO-0012']) assert.ok(t.includes(want), want);
  });
  it('Forms.open the report by docId for Rene (Production): it opens, from the visit only, with no peso anywhere', async () => {
    const app = makeApp(PEOPLE.rene, world().db); const F = await app.flowForms();
    const res = await F.open('site_visit_report', { docId: 'svAbCdEf1234' });
    assert.equal(res.ok, true, res.error);
    const html = app.log.open[0].bodyHtml;
    assert.ok(!html.includes('₱') && text(html).includes('Wall A 3,200 mm'));
    assert.ok(app.log.loaded.includes('js/forms-set-2.js') && !app.log.loaded.includes('js/forms-set-5.js'), 'only the Operations body set loaded');
  });
  it('the buttons: Sales gets site_visit_request, change_order and the report; Production gets only the report; a forced open of a money form is refused with the access message', async () => {
    const sales = await makeApp(PEOPLE.uriel, world().db).flowForms();
    assert.match(sales.buttonHtml('site_visit_request', { docId: 'svAbCdEf1234' }), /data-form="site_visit_request" data-ref="\{&quot;docId&quot;:&quot;svAbCdEf1234&quot;\}"/);
    assert.match(sales.buttonHtml('change_order', { docId: 'cr1', orderId: 'o', projectId: 'p' }), />Change Order<\/button>$/);
    assert.match(sales.buttonHtml('site_visit_report', { docId: 'svAbCdEf1234' }), />Site Visit Report<\/button>$/);
    const rene = makeApp(PEOPLE.rene, world().db); const F = await rene.flowForms();
    assert.equal(F.buttonHtml('site_visit_request', { docId: 'x' }), ''); assert.equal(F.buttonHtml('change_order', { docId: 'x' }), ''); assert.match(F.buttonHtml('site_visit_report', { docId: 'x' }), /data-form="site_visit_report"/);
    const res = await F.open('change_order', { docId: 'cr1' });
    assert.equal(res.ok, false); assert.equal(res.error, 'You do not have access to this document.'); assert.equal(rene.log.open.length, 0);
    assert.ok(!rene.log.loaded.includes('js/forms-set-5.js'), 'a viewer outside the audience loads no money-form code');
  });
  it('a missing doc says so plainly; Forms.downloadPdf works for the new forms', async () => {
    const app = makeApp(PEOPLE.uriel, world().db); const F = await app.flowForms();
    const res = await F.open('site_visit_request', { docId: 'nope' });
    assert.equal(res.ok, false); assert.equal(res.error, 'We could not find that record.');
    const pdf = await F.downloadPdf('change_order', { docId: 'cr1' });
    assert.equal(pdf.ok, true); assert.equal(pdf.fileName, 'CO-0004.pdf');
  });
});

describe('8. layout: the long title wraps, the totals label has room', () => {
  it('only a LONG title (the 42-character site visit one) gets the wrapping style; every earlier title keeps its single-line header exactly', () => {
    const long = compose('site_visit_request', PEOPLE.uriel).html;
    assert.ok(long.includes('<div class="fh-title" style="white-space:normal;max-width:330px">SITE VISIT REQUEST AND FEE ACKNOWLEDGEMENT</div>'));
    for (const id of ['change_order', 'site_visit_report']) assert.ok(compose(id, PEOPLE.uriel).html.includes(`<div class="fh-title">${FC.get(id).title}</div>`), id);
    for (const e of FC.list()) if (e.id !== 'site_visit_request') assert.ok(String(e.title).length <= 30, `${e.id} is short enough to stay on one line`);
  });
  it('h.totals takes an optional first-column width (a colgroup); without it the box is byte-for-byte as before', () => {
    const h = FC.makeHelpers(FC.get('change_order'));
    const rows = [{ label: 'NEW CONTRACT AMOUNT', amt: '₱1', cls: 'grand' }];
    assert.ok(h.totals(rows, 'n', { firstCol: '66%' }).includes('<colgroup><col style="width:66%"><col></colgroup>'));
    assert.ok(!h.totals(rows, 'n').includes('colgroup') && !h.totals(rows).includes('colgroup'));
    assert.ok(compose('change_order', PEOPLE.uriel).html.includes('<colgroup><col style="width:66%"><col></colgroup>'), 'the change order uses it');
  });
});
