// tests/change-orders.test.mjs — Phase 5 change requests and change orders, the screens, the down payment and Choice C (specs/SALES-FLOW-SPEC-2026-11-19.md §5.7 C1–C6, §7.2, §9.10, §12, §13.2 Phase 5).
//
//   1. WIRING   sw.js precaches the screen; it is not an index.html script; the job page has one flow-2-only host and a lazy guarded call; the screen reads through the accessor,
//               the Production notification and the record sheet carry no peso.
//   2. C1       Rene (or anyone but a secretary) records a request with NO price field: a money-free change_requests doc, Sales told, a timeline line without a peso; a price typed
//               into any text is refused.
//   3. BLOCK    the job's requests with their status words for EVERYONE ("Applied — see JO R2"); a Production login never queries change_orders or payment_claims and never sees a
//               price; Sales sees the price line and only the buttons that apply.
//   4. C2/C3    Sales prices it (lines, price that may be negative, added down payment, a CO- number, request -> priced), can re-price and decline; attaches the signed copy
//               (signed, Production told with no amount).
//   5. C4       the payment-claims record sheet's change-order picker: signed change orders with a down payment; the claim carries changeOrderId; a fully paid (prepaid) job can still take
//               it (balance + the change order's price); the confirmation checks the same ceiling.
//   6. C5/C6    Choice C is unlocked only once the signature AND the added down payment are in; the apply marks both docs applied with the revision number and adds HALF the price to
//               job_money.budget.changeOrderAdds exactly once; a failure of that step never undoes the apply.
// Mutation-checked in a scratch copy (see the hand-back).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PRES, SALES, FIN, PROD, makeBaseEnv, read, same } from './fixtures/sales-flow-harness.mjs';

const SW = read('sw.js'), HTML = read('index.html'), PRODSRC = read('js/screens/production.js'), CO = read('js/screens/change-orders.js'), PCUI = read('js/payment-claims-ui.js'), CUI = read('js/contract-ui.js');

describe('1. wiring', () => {
  const precache = (() => { const m = SW.match(/const PRECACHE = \[([\s\S]*?)\n\];/); return [...m[1].matchAll(/^\s*'([^']+)',?\s*(?:\/\/.*)?$/gm)].map((x) => x[1]); })();
  it('sw.js precaches change-orders next to site-visits and the other flow screens, on its own line', () => {
    const at = ['/js/screens/flow-docs.js', '/js/screens/site-visits.js', '/js/screens/change-orders.js'].map((f) => precache.indexOf(f));
    assert.ok(at.every((i) => i >= 0), String(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    assert.ok(SW.includes("\n  '/js/screens/change-orders.js',\n"));
  });
  it('it is LAZY (not an index.html script), loads its own core on demand, and reads Firestore through the accessor', () => {
    assert.doesNotMatch(HTML, /change-orders\.js/);
    assert.match(CO, /ensureScript\('js\/flow-core\.js'\)/);
    assert.match(CO, /const fsDb = function \(\) \{ return \(typeof db !== 'undefined' && db\) \|\| window\.db; \};/);
    assert.doesNotMatch(CO, /window\.db\s*\./);
  });
  it('the job page: ONE host, for flow-2 jobs that are not Brilliant-Steel-only, filled by a guarded lazy call that repaints in place', () => {
    assert.equal((PRODSRC.match(/id="jpd-chgorders"/g) || []).length, 1);
    assert.match(PRODSRC, /\$\{Number\(p\.flowVersion\)>=2 && !isBsOnlyU\?'<div id="jpd-chgorders"><\/div>':''\}/);
    assert.match(PRODSRC, /window\.ensureScript\('js\/screens\/change-orders\.js'\)\.then\(\(\)=>\{[\s\S]{0,420}renderJobChanges\(_chgHost, pj, _paintChg\)/);
  });
  it('no peso in the Production notification or in the record sheet; every dynamic value in an HTML string is escaped; toasts are plain text', () => {
    const at = CO.indexOf("sendToDept('Production'");
    const call = CO.slice(at, CO.indexOf('fallbackToOwner', at));
    assert.ok(at > 0);
    assert.doesNotMatch(call, /₱|money\(|signedMoney|price|amount/i);
    const sheet = CO.slice(CO.indexOf('async function openRequestSheet'), CO.indexOf('// ═══ C2'));
    assert.doesNotMatch(sheet, /₱|money\(|unitPrice|id="cr-[a-z-]*(price|amount|cost)/i);
    assert.doesNotMatch(CO, /innerHTML\s*=\s*[^;]*\$\{/);
    assert.doesNotMatch(CO, /toast\([^)]*<[a-z]/);
    assert.doesNotMatch(CO, /Rev\./);
  });
  it('the three payment-claims hooks and the contract hooks name the change order: changeOrderId on the claim, getClaimStatus, the budget step', () => {
    assert.match(PCUI, /changeOrderId: coId \|\| null/);
    assert.match(PCUI, /getChangeOrder: function \(id\) \{ return readDoc\('change_orders', id\); \}/);
    assert.match(CUI, /getClaimStatus: function \(id\) \{ return changeOrderClaimStatus\(id, coRead && coRead\.pricing && coRead\.pricing\.addedDownPayment\); \}/);
    assert.match(CUI, /await addBudgetShare\(order\.projectId, pr\.changeOrderId, result\.delta\)/);
    assert.doesNotMatch(CUI, /getClaimStatus: async function \(\) \{ return null; \}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
const order = (o = {}) => ({ projectId: 'prj1', quoteId: 'q1', quoteNumber: 'BK-1', soNumber: 'SO-0012', clientId: 'c1', clientName: 'Acme Foods', company: 'BK', contractAmount: 100000, paymentReceived: 65000, recordedAmount: 65000, vatTreatment: 'inclusive', status: 'recorded', flowVersion: 2, createdBy: 'u-sales', createdByName: 'Uriel', trackingToken: 'tok1', ...o });
const project = (o = {}) => ({ projectNo: 'JP-1', joNumber: 'JO-0012', salesOrderId: 'so1', clientId: 'c1', clientName: 'Acme Foods', stage: 'in_production', contractAmount: 100000, amountCollected: 65000, arBalance: 35000, flowVersion: 2, payments: [{ amount: 65000, date: '2026-11-18' }], documents: [], timeline: [], items: [{ name: 'Table', qty: 2 }], ...o });
const request = (o = {}) => ({ projectId: 'prj1', joNumber: 'JO-0012', clientName: 'Acme Foods', details: 'Client wants a shelf under the hood and one fewer work table', itemsAdded: [{ name: 'Shelf', qty: 2, unit: 'pc' }], itemsRemoved: [{ name: 'Table', qty: 1, unit: 'pc' }],
  effectOnDeadlineDays: 3, photos: [], status: 'requested', coNumber: null, requestedBy: 'u-prod', requestedByName: 'Rene', requestedAt: { seconds: 50, toDate: () => new Date(50000) }, ...o });
const co = (o = {}) => ({ orderId: 'so1', projectId: 'prj1', coNumber: 'CO-0004', pricing: { lines: [{ kind: 'added', name: 'Shelf', qty: 2, unit: 'pc', unitPrice: 10000, std: null }, { kind: 'removed', name: 'Table', qty: 1, unit: 'pc', unitPrice: 2000, std: null }], price: 18000, addedDownPayment: 9000 },
  status: 'priced', pricedBy: 'u-sales', pricedByName: 'Uriel', pricedAt: '2026-11-21T01:00:00.000Z', ...o });
const signedCo = (o = {}) => co({ status: 'signed', signed: { url: 'https://x.test/signed.pdf', name: 'signed.pdf', clientSignedBy: 'Maria', date: '2026-11-21', signedForBarroBy: 'Uriel', signedForBarroRole: 'Sales', by: 'u-sales', byName: 'Uriel', at: '2026-11-21T02:00:00.000Z' }, ...o });
const coClaim = (o = {}) => ({ kind: 'change_order', orderId: 'so1', projectId: 'prj1', quoteNumber: 'BK-1', clientId: 'c1', clientName: 'Acme Foods', company: 'BK', siteVisitId: null, changeOrderId: 'cr1', area: null, paymentReceived: 9000, paymentMethod: 'GCash', vatTreatment: 'inclusive', orRef: 'R-1',
  paymentDate: '2026-11-21', receiptUrl: 'https://r.example/p.pdf', receiptName: 'p.pdf', status: 'pending', paymentConfirm: { requestedAt: '2026-11-21T01:00:00.000Z', requestedBy: 'u-sales', requestedByName: 'Uriel', decision: null, resubmits: 0 }, createdBy: 'u-sales', createdByName: 'Uriel',
  createdAt: { seconds: 60, toDate: () => new Date(60000) }, ...o });

function makeForms() {
  const f = { counter: 0, numbers: [], fail: false };
  f.nextNumber = async (s) => { if (f.fail) throw new Error('counter down'); f.counter++; const n = `${s}-${String(f.counter).padStart(4, '0')}`; f.numbers.push(n); return n; };
  f.buttonHtml = (id, ref, o) => `<button type="button" data-form="${id}" data-ref='${JSON.stringify(ref)}'>${(o && o.label) || id}</button>`;
  f.bind = () => {};
  return f;
}
const LOAD = ['js/flow-core.js', 'js/payment-claims-core.js', 'js/payment-claims-ui.js', 'js/price-gate-core.js', 'js/contract-core.js', 'js/contract-ui.js', 'js/screens/flow-docs.js', 'js/screens/change-orders.js'];
function env(who, { so = {}, pj = {}, requests = {}, cos = {}, claims = {}, seed = {}, ...opts } = {}) {
  const forms = makeForms();
  const e = makeBaseEnv(who, { seed: { sales_orders: { so1: order(so) }, job_projects: { prj1: project(pj) }, change_requests: requests, change_orders: cos, payment_claims: claims, bk_quotes: { q1: { quoteNumber: 'BK-1', total: 100000, rootQuoteId: 'q1', approvalStatus: 'approved', approvedBy: 'u-pres', items: [{ name: 'Table', qty: 2 }] } }, ...seed }, forms, ...opts });
  const c = e.ctx;
  c.canEditDept = (d) => who.role === 'president' || who.role === 'manager' || (who.depts || []).includes(d);
  c.flowForms = () => c.ensureScript('js/forms.js').then(() => c.Forms);
  for (const f of LOAD) e.load(read(f), f);
  e.CO = c.ChangeOrders; e.fakeForms = forms;
  e.so = () => e.db.store.sales_orders.get('so1');
  e.pj = () => e.db.store.job_projects.get('prj1');
  e.req = (id = 'cr1') => (e.db.store.change_requests || new Map()).get(id);
  e.reqs = () => [...(e.db.store.change_requests || new Map()).entries()];
  e.co = (id = 'cr1') => (e.db.store.change_orders || new Map()).get(id);
  e.claims = () => [...(e.db.store.payment_claims || new Map()).entries()];
  e.ledger = () => [...(e.db.store.ledger || new Map()).entries()];
  e.money = () => (e.db.store.job_money || new Map()).get('prj1');
  e.queried = () => [...new Set(e.db.log.filter((l) => l.op === 'query').map((l) => l.path))];
  return e;
}
// a host with the buttons the block draws, so a click can be fired on them
function hostOf() {
  const h = { innerHTML: '', _btns: null };
  const parse = () => {
    if (h._btns && h._html === h.innerHTML) return h._btns;
    h._html = h.innerHTML; h._btns = { record: [], items: [] };
    const mk = () => ({ fns: [], addEventListener(t, fn) { this.fns.push(fn); }, async click() { return Promise.all(this.fns.map((fn) => fn({ stopPropagation() {} }))); } });
    const rec = /class="[^"]*co-record[^"]*"/.test(h.innerHTML) ? mk() : null;
    h._btns.record = rec;
    for (const seg of h.innerHTML.split('<div class="co-item" data-id="').slice(1)) {
      const id = seg.slice(0, seg.indexOf('"'));
      const btns = {};
      for (const k of ['co-price', 'co-sign', 'co-decline', 'co-pay', 'co-revise']) if (new RegExp('class="[^"]*\\b' + k + '\\b').test(seg)) btns[k] = mk();
      h._btns.items.push({ dataset: { id }, querySelector: (sel) => btns[sel.slice(1)] || null, btns });
    }
    return h._btns;
  };
  h.querySelector = (sel) => (sel === '.co-record' ? parse().record : null);
  h.querySelectorAll = (sel) => (sel === '.co-item' ? parse().items : []);
  h.item = (id) => parse().items.find((x) => x.dataset.id === id);
  return h;
}
const draw = async (e, pj) => { const h = hostOf(); await e.CO.renderJobChanges(h, { id: 'prj1', ...(pj || e.pj()) }, () => {}); return h; };

const fillRows = (p, prefix, rows) => rows.forEach((r, i) => { p.$(`cr-${prefix}-name-${i}`).value = r.name || ''; p.$(`cr-${prefix}-qty-${i}`).value = String(r.qty ?? ''); p.$(`cr-${prefix}-unit-${i}`).value = r.unit || ''; });
const record = async (e, { details = 'Client wants a shelf under the canopy hood', add = [{ name: 'Shelf', qty: 2, unit: 'pc' }], rem = [], days = '3', photos = [] } = {}) => {
  await e.CO.openRequestSheet({ id: 'prj1', ...e.pj() });
  const p = e.lastPage();
  assert.ok(p && p.$('cr-save'), 'the request sheet opened: ' + e.toastMsgs().join('|'));
  p.$('cr-details').value = details; fillRows(p, 'add', add); fillRows(p, 'rem', rem); p.$('cr-days').value = days;
  photos.forEach((ph) => e.uploads['cr-photos'].cb(ph));
  await p.$('cr-save').click();
  return p;
};

describe('2. C1 — record a change request (no price field)', () => {
  it('Rene records one: a money-free change_requests doc in the spec shape, status requested, requestedBy / At, job and client carried', async () => {
    const e = env(PROD);
    await record(e, { add: [{ name: 'Shelf', qty: 2, unit: 'pc' }], rem: [{ name: 'Work table', qty: 1, unit: '' }], photos: [{ url: 'https://x.test/a.jpg', name: 'a.jpg' }] });
    assert.equal(e.reqs().length, 1, e.toastMsgs().join('|'));
    const r = e.reqs()[0][1];
    assert.equal(r.projectId, 'prj1'); assert.equal(r.joNumber, 'JO-0012'); assert.equal(r.clientName, 'Acme Foods'); assert.equal(r.status, 'requested'); assert.equal(r.coNumber, null);
    assert.equal(r.details, 'Client wants a shelf under the canopy hood'); assert.equal(r.effectOnDeadlineDays, 3);
    assert.deepEqual(r.itemsAdded, [{ name: 'Shelf', qty: 2, unit: 'pc' }]); assert.deepEqual(r.itemsRemoved, [{ name: 'Work table', qty: 1, unit: 'pc' }]);
    assert.deepEqual(r.photos, [{ url: 'https://x.test/a.jpg', name: 'a.jpg' }]);
    assert.equal(r.requestedBy, 'u-prod'); assert.equal(r.requestedByName, 'Rene'); assert.ok(r.requestedAt && r.updatedAt);
    for (const k of ['pricing', 'price', 'unitPrice', 'amount', 'addedDownPayment']) assert.ok(!(k in r), `the rules refuse ${k} on a change request`);
    assert.doesNotMatch(JSON.stringify(r), /₱|price|amount/i);
    assert.match(e.toastMsgs().join('|'), /Sales will price it/);
  });
  it('the sheet has no price field at all', async () => {
    const e = env(PROD);
    await e.CO.openRequestSheet({ id: 'prj1', ...e.pj() });
    const html = e.lastPage().html;
    assert.doesNotMatch(html, /₱/); assert.doesNotMatch(html, /id="cr-[a-z-]*(price|amount|cost|fee)/i); assert.doesNotMatch(html, /type="number"[^>]*placeholder="[^"]*(price|₱)/i);
  });
  it('Sales is told "Change request to price": who, client, the first 80 characters of the details; the dedup key carries the request id; Production is not', async () => {
    const e = env(PROD);
    const long = 'Client wants a big change: ' + 'x'.repeat(120);
    await record(e, { details: long });
    const id = e.reqs()[0][0];
    const n = e.notifs.filter((x) => x.kind === 'dept' && x.dept === 'Sales');
    assert.equal(n.length, 1);
    assert.equal(n[0].type, 'change_request'); assert.equal(n[0].title, '📝 Change request to price'); assert.equal(n[0].dedupKey, 'crreq-' + id); same(n[0].opts, { fallbackToOwner: true });
    assert.equal(n[0].body, 'Rene: Acme Foods — ' + long.slice(0, 80));
    assert.ok(!e.notifs.some((x) => x.dept === 'Production'));
  });
  it('the job\'s timeline gets one line without a peso', async () => {
    const e = env(PROD);
    await record(e);
    const t = e.pj().timeline;
    assert.equal(t.length, 1); assert.match(t[0].event, /^Change requested — Client wants a shelf/); assert.doesNotMatch(t[0].event, /₱/);
  });
  it('refused in plain words, nothing written: short details, a nameless row, a zero quantity, days that are not a whole number, a price typed into the details or a row', async () => {
    const e = env(PROD);
    for (const [o, re] of [[{ details: 'no' }, /Describe the change/], [{ add: [{ name: '', qty: 2 }] }, /name/], [{ add: [{ name: 'Shelf', qty: 0 }] }, /quantity/], [{ days: '1.5' }, /whole number/],
      [{ details: 'Add a shelf for ₱5,000' }, /Prices do not go in here/], [{ add: [{ name: 'Shelf PHP 500', qty: 1 }] }, /Prices do not go in here/]]) {
      const p = await record(e, o);
      assert.match(p.$('cr-err').textContent, re);
    }
    assert.equal(e.reqs().length, 0);
  });
  it('who may record: any staff (Production, Sales, Finance, the President); not a secretary; not on a closed, cancelled or legacy job', async () => {
    for (const who of [PROD, SALES, FIN, PRES]) { const e = env(who); await e.CO.openRequestSheet({ id: 'prj1', ...e.pj() }); assert.equal(e.pages.length, 1, who.name); }
    const sec = env({ role: 'secretary', depts: ['Production'], uid: 'u-sec', name: 'Sec' }); await sec.CO.openRequestSheet({ id: 'prj1', ...sec.pj() });
    assert.equal(sec.pages.length, 0);
    for (const pj of [{ stage: 'paid' }, { stage: 'cancelled' }, { flowVersion: undefined }]) {
      const e = env(PROD, { pj }); await e.CO.openRequestSheet({ id: 'prj1', ...e.pj() });
      assert.equal(e.pages.length, 0, JSON.stringify(pj));
    }
  });
  it('a double tap records one request', async () => {
    const e = env(PROD);
    await e.CO.openRequestSheet({ id: 'prj1', ...e.pj() });
    const p = e.lastPage(); p.$('cr-details').value = 'Client wants a shelf'; fillRows(p, 'add', [{ name: 'Shelf', qty: 1, unit: 'pc' }]);
    await Promise.all([p.$('cr-save').click(), p.$('cr-save').click()]);
    assert.equal(e.reqs().length, 1);
  });
  it('a failed Sales notification never fails the write', async () => {
    const e = env(PROD);
    e.ctx.Notifs.sendToDept = async () => { throw new Error('offline'); };
    await record(e);
    assert.equal(e.reqs().length, 1);
  });
});

describe('3. the job\'s block — status words for everyone, prices only for those who may read them', () => {
  const world = () => ({
    requests: { r1: request({ details: 'First', status: 'requested', requestedAt: { seconds: 10 } }), r2: request({ details: 'Second', status: 'priced', coNumber: 'CO-0001', requestedAt: { seconds: 20 } }), r3: request({ details: 'Third', status: 'signed', coNumber: 'CO-0002', requestedAt: { seconds: 30 } }),
      r4: request({ details: 'Fourth', status: 'applied', coNumber: 'CO-0003', appliedContractRev: 2, requestedAt: { seconds: 40 } }), r5: request({ details: 'Fifth', status: 'declined', declineReason: 'the client dropped it', requestedAt: { seconds: 50 } }) },
    cos: { r2: co({ coNumber: 'CO-0001' }), r3: signedCo({ coNumber: 'CO-0002' }), r4: signedCo({ coNumber: 'CO-0003', status: 'applied', appliedContractRev: 2 }) },
  });
  it('a Production login sees every status word — Requested, Priced, Signed, Applied — see JO R2, Declined — and the details, never a price or a CO number', async () => {
    const e = env(PROD, world());
    const h = await draw(e);
    for (const w of ['Requested', 'Priced', 'Signed', 'Applied — see JO R2', 'Declined', 'First', 'Fifth', 'the client dropped it', 'Added: 2 pc Shelf', 'Removed: 1 pc Table', 'Deadline: +3 days']) assert.ok(h.innerHTML.includes(w), w);
    assert.doesNotMatch(h.innerHTML, /₱|CO-000|down payment|\+18,000|18,000/);
    assert.ok(h.innerHTML.indexOf('Fifth') < h.innerHTML.indexOf('First'), 'newest first');
  });
  it('a Production login NEVER queries change_orders or payment_claims (a permission error there would be a bug) — only change_requests', async () => {
    const e = env(PROD, world());
    await draw(e);
    assert.deepEqual(e.queried(), ['change_requests']);
    assert.ok(!e.db.log.some((l) => /change_orders|payment_claims/.test(l.path)));
  });
  it('who reads change_orders follows the rules: Sales, the books tier and the President do; Production, Design, a Production + Design login and the Corporate Secretary do NOT (they stop at change_requests)', async () => {
    const people = [[PROD, false], [{ role: 'employee', depts: ['Design'], uid: 'u-d', name: 'D' }, false], [{ role: 'employee', depts: ['Production', 'Design'], uid: 'u-pd', name: 'PD' }, false],
      [{ role: 'secretary', depts: ['Sales', 'Production'], uid: 'u-s', name: 'Sec' }, false], [{ role: 'employee', depts: [], uid: 'u-n', name: 'N' }, false],
      [SALES, true], [FIN, true], [PRES, true], [{ role: 'manager', depts: [], uid: 'u-m', name: 'M' }, true], [{ role: 'employee', depts: ['Finance'], uid: 'u-f2', name: 'F2' }, true]];
    for (const [who, reads] of people) {
      const e = env(who, world());
      await draw(e);
      assert.equal(e.queried().includes('change_orders'), reads, `${who.role} ${JSON.stringify(who.depts)}`);
      assert.ok(e.queried().includes('change_requests'));
      assert.equal(e.CO.seesPrices(), reads, `${who.role} ${JSON.stringify(who.depts)}`);
    }
  });
  it('Production gets "Record change request" (any staff) and no price, sign or decline button', async () => {
    const e = env(PROD, world());
    const h = await draw(e);
    assert.ok(h.querySelector('.co-record'));
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) for (const k of ['co-price', 'co-sign', 'co-decline', 'co-pay', 'co-revise']) assert.ok(!h.item(id).querySelector('.' + k), `${id} ${k}`);
    assert.doesNotMatch(h.innerHTML, /data-form=/, 'no money form is offered to Production');
  });
  it('Sales sees the price line (CO number, ± price, added down payment) and the buttons that apply to each status', async () => {
    const e = env(SALES, world());
    const h = await draw(e);
    assert.ok(h.innerHTML.includes('CO-0001') && h.innerHTML.includes('+₱18,000.00') && h.innerHTML.includes('added down payment ₱9,000.00'));
    assert.deepEqual(Object.keys(h.item('r1').btns).sort(), ['co-decline', 'co-price']);
    assert.deepEqual(Object.keys(h.item('r2').btns).sort(), ['co-decline', 'co-price', 'co-sign']);
    assert.ok(h.item('r3').btns['co-pay'], 'signed with a down payment that is not recorded: Record down payment'); assert.ok(!h.item('r3').btns['co-revise']);
    assert.deepEqual(Object.keys(h.item('r4').btns), []); assert.deepEqual(Object.keys(h.item('r5').btns), []);
    assert.match(h.innerHTML, /data-form="change_order"/);
  });
  it('a signed change order whose down payment is confirmed offers "Revise contract amount"; while it waits, neither button', async () => {
    const e = env(SALES, { requests: { cr1: request({ status: 'signed', coNumber: 'CO-0004' }) }, cos: { cr1: signedCo() }, claims: { c1: coClaim({ status: 'recorded', recordedAmount: 9000 }) } });
    const ready = await draw(e);
    assert.ok(ready.item('cr1').btns['co-revise']); assert.ok(!ready.item('cr1').btns['co-pay']); assert.match(ready.innerHTML, /\(confirmed\)/);
    const w = env(SALES, { requests: { cr1: request({ status: 'signed', coNumber: 'CO-0004' }) }, cos: { cr1: signedCo() }, claims: { c1: coClaim() } });
    const waiting = await draw(w);
    assert.ok(!waiting.item('cr1').btns['co-revise'] && !waiting.item('cr1').btns['co-pay']); assert.match(waiting.innerHTML, /waiting for confirmation/);
    const free = env(SALES, { requests: { cr1: request({ status: 'signed', coNumber: 'CO-0004' }) }, cos: { cr1: signedCo({ pricing: { lines: [], price: -5000, addedDownPayment: 0 } }) } });
    assert.ok((await draw(free)).item('cr1').btns['co-revise'], 'no down payment asked: ready as soon as it is signed');
  });
  it('a Finance login sees the price but gets no pricing button; the President gets them all', async () => {
    const f = await draw(env(FIN, world()));
    assert.ok(f.innerHTML.includes('+₱18,000.00')); assert.deepEqual(Object.keys(f.item('r1').btns), []);
    const p = await draw(env(PRES, world()));
    assert.deepEqual(Object.keys(p.item('r2').btns).sort(), ['co-decline', 'co-price', 'co-sign']);
  });
  it('a closed job has no Record button; a job with no requests says so; a legacy job draws nothing; the block is silent when it cannot read', async () => {
    const closed = await draw(env(PROD, { pj: { stage: 'paid' }, requests: {} }), project({ stage: 'paid' }));
    assert.ok(!closed.querySelector('.co-record')); assert.match(closed.innerHTML, /No change requests on this job/);
    const legacy = env(PROD); const h = hostOf(); await legacy.CO.renderJobChanges(h, { id: 'prj1', ...project({ flowVersion: undefined }) }, () => {});
    assert.equal(h.innerHTML, '');
    const broken = env(PROD); broken.ctx.db.collection = () => { throw new Error('offline'); }; const hb = hostOf(); hb.innerHTML = 'before';
    await broken.CO.renderJobChanges(hb, { id: 'prj1', ...project() }, () => {});
    assert.equal(hb.innerHTML, '');
  });
  it('the buttons open the sheets: price, sign, decline, record down payment, revise contract amount', async () => {
    const e = env(SALES, { requests: { cr1: request({ status: 'priced', coNumber: 'CO-0004' }), cr2: request({ status: 'requested' }), cr3: request({ status: 'signed', coNumber: 'CO-0005' }), cr4: request({ status: 'signed', coNumber: 'CO-0006' }) },
      cos: { cr1: co(), cr3: signedCo({ coNumber: 'CO-0005' }), cr4: signedCo({ coNumber: 'CO-0006', pricing: { lines: [], price: -1000, addedDownPayment: 0 } }) } });
    const h = await draw(e);
    const before = () => e.pages.length;
    let n = before(); await h.item('cr2').btns['co-price'].click(); await new Promise((r) => setTimeout(r, 5)); assert.ok(e.lastPage().$('cp-save') && e.pages.length === n + 1, 'price sheet');
    n = before(); await h.item('cr1').btns['co-sign'].click(); await new Promise((r) => setTimeout(r, 5)); assert.ok(e.lastPage().$('cs-save') && e.pages.length === n + 1, 'sign sheet');
    n = before(); await h.item('cr3').btns['co-pay'].click(); await new Promise((r) => setTimeout(r, 5)); assert.ok(e.lastPage().$('pr-save') && e.pages.length === n + 1, 'record payment sheet');
    n = before(); await h.item('cr4').btns['co-revise'].click(); await new Promise((r) => setTimeout(r, 5)); assert.ok(e.lastPage().$('rv-send') && e.pages.length === n + 1, 'revise sheet');
    await h.item('cr1').btns['co-decline'].click(); assert.equal(e.db.store.change_requests.get('cr1').status, 'declined');
  });
});

const priceSheet = async (e, id = 'cr1') => { await e.CO.openPriceSheet({ id }); const p = e.lastPage(); assert.ok(p && p.$('cp-save'), 'the price sheet opened: ' + e.toastMsgs().join('|')); return p; };
const fillLine = (p, i, l) => { p.$(`cp-kind-${i}`).value = l.kind || 'added'; p.$(`cp-name-${i}`).value = l.name; p.$(`cp-qty-${i}`).value = String(l.qty); p.$(`cp-unit-${i}`).value = l.unit || 'pc'; p.$(`cp-price-${i}`).value = String(l.unitPrice); };

describe('4. C2 / C3 — price it, decline it, attach the signed copy', () => {
  it('the sheet starts from the request\'s own items (Added / Removed, no price yet) and shows the live new contract amount', async () => {
    const e = env(SALES, { requests: { cr1: request() } });
    const p = await priceSheet(e);
    assert.equal(p.$('cp-kind-0').value, 'added'); assert.equal(p.$('cp-name-0').value, 'Shelf'); assert.equal(p.$('cp-qty-0').value, '2'); assert.equal(p.$('cp-price-0').value, '');
    assert.equal(p.$('cp-kind-1').value, 'removed'); assert.equal(p.$('cp-name-1').value, 'Table');
    assert.match(p.html, /contract ₱100,000\.00/);
    fillLine(p, 0, { name: 'Shelf', qty: 2, unitPrice: 10000 }); await p.$('cp-price-0').fire('input');
    assert.match(p.$('cp-summary').innerHTML, /New contract amount: <strong>₱120,000\.00<\/strong>/);
  });
  it('Sales prices it: change_orders/{request id} with orderId, projectId, a CO- number, the lines, the price (added − removed), the added down payment; the request becomes priced', async () => {
    const e = env(SALES, { requests: { cr1: request() } });
    const p = await priceSheet(e);
    fillLine(p, 0, { kind: 'added', name: 'Shelf', qty: 2, unitPrice: 10000 }); fillLine(p, 1, { kind: 'removed', name: 'Table', qty: 1, unitPrice: 2000 }); p.$('cp-dp').value = '9000';
    await p.$('cp-save').click();
    const c = e.co();
    assert.ok(c, e.toastMsgs().join('|'));
    assert.equal(c.orderId, 'so1'); assert.equal(c.projectId, 'prj1'); assert.equal(c.coNumber, 'CO-0001'); assert.equal(c.status, 'priced');
    assert.equal(c.pricing.price, 18000); assert.equal(c.pricing.addedDownPayment, 9000);
    assert.deepEqual(c.pricing.lines.map((l) => [l.kind, l.name, l.qty, l.unit, l.unitPrice, l.std]), [['added', 'Shelf', 2, 'pc', 10000, null], ['removed', 'Table', 1, 'pc', 2000, null]]);
    assert.equal(c.pricedBy, 'u-sales'); assert.equal(c.pricedByName, 'Uriel'); assert.ok(c.pricedAt && c.updatedAt);
    const r = e.req();
    assert.equal(r.status, 'priced'); assert.equal(r.coNumber, 'CO-0001'); assert.equal(r.pricedByName, 'Uriel');
    for (const k of ['pricing', 'price', 'unitPrice', 'amount', 'addedDownPayment']) assert.ok(!(k in r), `the request never holds ${k}`);
    assert.doesNotMatch(JSON.stringify(r), /₱/);
    assert.match(e.pj().timeline.map((t) => t.event).join('|'), /Change order priced — CO-0001/); assert.doesNotMatch(JSON.stringify(e.pj().timeline), /₱|18,?000/);
  });
  it('a request with the most items it can hold (8 added + 8 removed) seeds every one of them as a line to price — none is silently dropped', async () => {
    const add = Array.from({ length: 8 }, (_, i) => ({ name: 'Added ' + (i + 1), qty: 1, unit: 'pc' })), rem = Array.from({ length: 8 }, (_, i) => ({ name: 'Removed ' + (i + 1), qty: 1, unit: 'pc' }));
    const e = env(SALES, { requests: { cr1: request({ itemsAdded: add, itemsRemoved: rem }) } });
    const p = await priceSheet(e);
    for (let i = 0; i < 16; i++) assert.equal(p.$(`cp-name-${i}`).value, i < 8 ? 'Added ' + (i + 1) : 'Removed ' + (i - 7), String(i));
    for (let i = 0; i < 16; i++) p.$(`cp-price-${i}`).value = '100';
    await p.$('cp-save').click();
    assert.equal(e.co().pricing.lines.length, 16); assert.equal(e.co().pricing.price, 0, '8 added − 8 removed at 100 each');
  });
  it('the price may be negative (items removed only), and a zero-price swap is allowed', async () => {
    const e = env(SALES, { requests: { cr1: request({ itemsAdded: [] }) } });
    const p = await priceSheet(e);
    fillLine(p, 0, { kind: 'removed', name: 'Table', qty: 1, unitPrice: 4500 });
    await p.$('cp-save').click();
    assert.equal(e.co().pricing.price, -4500); assert.equal(e.co().pricing.addedDownPayment, 0); assert.equal(e.req().status, 'priced');
    const z = env(SALES, { requests: { cr1: request() } });
    const pz = await priceSheet(z);
    fillLine(pz, 0, { kind: 'added', name: 'Shelf', qty: 1, unitPrice: 800 }); fillLine(pz, 1, { kind: 'removed', name: 'Rack', qty: 1, unitPrice: 800 });
    await pz.$('cp-save').click();
    assert.equal(z.co().pricing.price, 0);
  });
  it('refused in plain words, nothing written: no priced line, a missing price, a down payment above the price or on a price that does not rise', async () => {
    const e = env(SALES, { requests: { cr1: request() } });
    const p = await priceSheet(e);
    await p.$('cp-save').click(); assert.match(p.$('cp-err').textContent, /unit price/);
    fillLine(p, 0, { name: 'Shelf', qty: 2, unitPrice: 1000 }); fillLine(p, 1, { kind: 'removed', name: 'Table', qty: 1, unitPrice: 500 }); p.$('cp-dp').value = '5000';
    await p.$('cp-save').click(); assert.match(p.$('cp-err').textContent, /more than the price/);
    fillLine(p, 0, { kind: 'removed', name: 'Shelf', qty: 2, unitPrice: 1000 }); p.$('cp-dp').value = '1';
    await p.$('cp-save').click(); assert.match(p.$('cp-err').textContent, /raises the price/);
    assert.equal(e.co(), undefined); assert.equal(e.req().status, 'requested');
  });
  it('re-pricing a priced one keeps its CO- number and burns no number; a signed, applied or declined one cannot be priced again', async () => {
    const e = env(SALES, { requests: { cr1: request({ status: 'priced', coNumber: 'CO-0009' }) }, cos: { cr1: co({ coNumber: 'CO-0009' }) } });
    const p = await priceSheet(e);
    assert.match(e.lastPage().title, /Edit price/);
    assert.equal(p.$('cp-price-0').value, '10000');
    fillLine(p, 0, { name: 'Shelf', qty: 2, unitPrice: 12000 }); p.$('cp-dp').value = '0';
    await p.$('cp-save').click();
    assert.equal(e.co().coNumber, 'CO-0009'); assert.equal(e.co().pricing.price, 22000); assert.equal(e.fakeForms.numbers.length, 0, 'no CO number was taken');
    for (const status of ['signed', 'applied', 'declined']) {
      const x = env(SALES, { requests: { cr1: request({ status }) }, cos: { cr1: co({ status }) } });
      await x.CO.openPriceSheet({ id: 'cr1' }); assert.equal(x.pages.length, 0, status);
    }
  });
  it('the counter down: the change order still gets CO- + the last six characters of the request id', async () => {
    const e = env(SALES, { requests: { crAbCdEf12: request({ itemsRemoved: [] }) } }); e.fakeForms.fail = true;
    const p = await priceSheet(e, 'crAbCdEf12');
    fillLine(p, 0, { name: 'Shelf', qty: 1, unitPrice: 100 });
    await p.$('cp-save').click();
    assert.equal(e.co('crAbCdEf12').coNumber, 'CO-CDEF12');
  });
  it('who may price: Sales and the President; not Production, not Finance; a job with no sales order or a closed job is refused', async () => {
    for (const who of [PROD, FIN]) { const e = env(who, { requests: { cr1: request() } }); await e.CO.openPriceSheet({ id: 'cr1' }); assert.equal(e.pages.length, 0, who.name); assert.match(e.toastMsgs().join('|'), /Only Sales or the President/); }
    const pres = env(PRES, { requests: { cr1: request() } }); await pres.CO.openPriceSheet({ id: 'cr1' }); assert.equal(pres.pages.length, 1);
    const noSo = env(SALES, { pj: { salesOrderId: undefined }, requests: { cr1: request() } }); await noSo.CO.openPriceSheet({ id: 'cr1' }); assert.equal(noSo.pages.length, 0);
    const closed = env(SALES, { pj: { stage: 'paid' }, requests: { cr1: request() } }); await closed.CO.openPriceSheet({ id: 'cr1' }); assert.equal(closed.pages.length, 0);
  });
  it('a double tap prices once', async () => {
    const e = env(SALES, { requests: { cr1: request({ itemsRemoved: [] }) } });
    const p = await priceSheet(e); fillLine(p, 0, { name: 'Shelf', qty: 1, unitPrice: 100 });
    await Promise.all([p.$('cp-save').click(), p.$('cp-save').click()]);
    assert.equal(e.fakeForms.numbers.length, 1);
  });
  it('Decline: a reason is required and cannot hold a price; a requested or priced request is declined (and its change order); a signed one is not', async () => {
    const e = env(SALES, { requests: { cr1: request({ status: 'priced' }), cr2: request(), cr3: request({ status: 'signed' }) }, cos: { cr1: co(), cr3: signedCo() } });
    e.promptAnswer = 'Client dropped it ₱500';
    assert.equal(await e.CO.declineRequest({ id: 'cr1' }), false); assert.match(e.toastMsgs().join('|'), /Prices do not go in here/); assert.equal(e.req('cr1').status, 'priced');
    e.promptAnswer = 'The client dropped the change';
    assert.equal(await e.CO.declineRequest({ id: 'cr1' }), true);
    assert.equal(e.req('cr1').status, 'declined'); assert.equal(e.req('cr1').declineReason, 'The client dropped the change'); assert.equal(e.co('cr1').status, 'declined'); assert.equal(e.req('cr1').declinedByName, 'Uriel');
    assert.equal(await e.CO.declineRequest({ id: 'cr2' }), true); assert.equal(e.req('cr2').status, 'declined');
    assert.equal(await e.CO.declineRequest({ id: 'cr3' }), false); assert.equal(e.req('cr3').status, 'signed'); assert.equal(e.co('cr3').status, 'signed');
    const prod = env(PROD, { requests: { cr1: request() } });
    assert.equal(await prod.CO.declineRequest({ id: 'cr1' }), false); assert.equal(prod.req().status, 'requested');
  });
  const signSheet = async (e, id = 'cr1') => { await e.CO.openSignSheet({ id }); const p = e.lastPage(); assert.ok(p && p.$('cs-save'), 'the sign sheet opened: ' + e.toastMsgs().join('|')); return p; };
  const fillSign = (e, p, o = {}) => { if (o.file !== false) e.uploads['cs-upload'].cb({ url: 'https://x.test/signed.pdf', name: 'signed.pdf' }); p.$('cs-client').value = o.client ?? 'Maria Santos'; p.$('cs-date').value = o.date ?? '2026-11-21'; };
  it('C3: the signed copy, who signed for the client and for Barro, the date -> change_orders.signed and status signed; the request becomes signed; Production is told (no amount)', async () => {
    const e = env(SALES, { requests: { cr1: request({ status: 'priced', coNumber: 'CO-0004' }) }, cos: { cr1: co() } });
    const p = await signSheet(e);
    assert.equal(p.$('cs-barro').value, 'Uriel'); assert.equal(p.$('cs-role').value, 'Sales');
    fillSign(e, p, {}); p.$('cs-barro').value = 'Neil Barro'; p.$('cs-role').value = 'President';
    await p.$('cs-save').click();
    const c = e.co();
    assert.equal(c.status, 'signed');
    assert.equal(c.signed.url, 'https://x.test/signed.pdf'); assert.equal(c.signed.name, 'signed.pdf'); assert.equal(c.signed.clientSignedBy, 'Maria Santos'); assert.equal(c.signed.date, '2026-11-21');
    assert.equal(c.signed.signedForBarroBy, 'Neil Barro'); assert.equal(c.signed.signedForBarroRole, 'President'); assert.equal(c.signed.by, 'u-sales'); assert.ok(c.signed.at);
    assert.equal(e.req().status, 'signed');
    const n = e.notifs.filter((x) => x.kind === 'dept' && x.dept === 'Production');
    assert.equal(n.length, 1);
    assert.equal(n[0].type, 'change_order_signed'); assert.equal(n[0].dedupKey, 'cosigned-cr1'); assert.equal(n[0].body, 'Acme Foods — CO-0004. The new job order follows.'); same(n[0].opts, { fallbackToOwner: true });
    assert.doesNotMatch(n[0].title + n[0].body, /₱|\d,\d{3}|price|amount|paid/i);
    assert.match(e.pj().timeline.map((t) => t.event).join('|'), /Change order signed — CO-0004/);
  });
  it('the signed copy, the signer and the date are required; only a priced change order can be signed; a double tap signs once', async () => {
    const e = env(SALES, { requests: { cr1: request({ status: 'priced' }) }, cos: { cr1: co() } });
    let p = await signSheet(e); fillSign(e, p, { file: false }); await p.$('cs-save').click(); assert.match(p.$('cs-err').textContent, /signed copy/);
    p = await signSheet(e); fillSign(e, p, { client: '' }); await p.$('cs-save').click(); assert.match(p.$('cs-err').textContent, /client/);
    p = await signSheet(e); fillSign(e, p, { date: '' }); await p.$('cs-save').click(); assert.match(p.$('cs-err').textContent, /date/);
    assert.equal(e.co().status, 'priced');
    p = await signSheet(e); fillSign(e, p, {});
    await Promise.all([p.$('cs-save').click(), p.$('cs-save').click()]);
    assert.equal(e.notifs.filter((x) => x.dept === 'Production').length, 1);
    for (const status of ['signed', 'applied', 'declined']) { const x = env(SALES, { requests: { cr1: request({ status }) }, cos: { cr1: co({ status }) } }); await x.CO.openSignSheet({ id: 'cr1' }); assert.equal(x.pages.length, 0, status); }
    // another tab signed it while this sheet was open: the save re-reads the change order and refuses (no second copy, no second notification)
    const stale = env(SALES, { requests: { cr1: request({ status: 'priced' }) }, cos: { cr1: co() } });
    const ps = await signSheet(stale); fillSign(stale, ps, {});
    stale.db.store.change_orders.get('cr1').status = 'signed'; stale.db.store.change_orders.get('cr1').signed = { url: 'https://x.test/first.pdf' };
    await ps.$('cs-save').click();
    assert.match(stale.toastMsgs().join('|'), /already signed or changed/); assert.equal(stale.co().signed.url, 'https://x.test/first.pdf'); assert.ok(!stale.notifs.some((x) => x.dept === 'Production'));
    const prod = env(PROD, { requests: { cr1: request({ status: 'priced' }) }, cos: { cr1: co() } }); await prod.CO.openSignSheet({ id: 'cr1' }); assert.equal(prod.pages.length, 0);
  });
});

// ═══ C4 — the down payment ═══════════════════════════════════════════════════════════════════════════════════════════════════
const recSheet = async (e) => { await e.ctx.PaymentClaimsUI.openRecordSheet({ orderId: 'so1' }); const p = e.lastPage(); assert.ok(p && p.$('pr-save'), 'the record sheet opened: ' + e.toastMsgs().join('|')); return p; };
const submit = async (e, p, { amount, ref = 'R-1', receipt = true } = {}) => { if (amount !== undefined) p.$('pr-amount').value = String(amount); p.$('pr-ref').value = ref; if (receipt) e.uploads['pr-upload'].cb({ url: 'https://r.example/proof.pdf', name: 'proof.pdf' }); await p.$('pr-save').click(); };
const withCo = (o = {}) => ({ requests: { cr1: request({ status: 'signed', coNumber: 'CO-0004' }) }, cos: { cr1: signedCo() }, ...o });

describe('5. C4 — the change-order down payment in the record sheet', () => {
  it('"Change-order down payment" shows a picker of THIS order\'s signed change orders that ask for a down payment — not unsigned, applied, other orders\' or zero-down-payment ones', async () => {
    const e = env(SALES, { requests: {}, cos: { cr1: signedCo(), cr2: co(), cr3: signedCo({ status: 'applied', appliedContractRev: 1 }), cr4: signedCo({ orderId: 'other' }), cr5: signedCo({ pricing: { lines: [], price: 5000, addedDownPayment: 0 } }) } });
    const p = await recSheet(e);
    assert.match(p.html, /id="pr-co-wrap"/); assert.match(p.html, /class="form-group hidden" id="pr-co-wrap"/, 'hidden until the type is Change-order down payment');
    assert.match(p.html, /<option value="cr1" selected>CO-0004 · down payment ₱9,000\.00<\/option>/);
    for (const id of ['cr2', 'cr3', 'cr4', 'cr5']) assert.ok(!p.html.includes(`value="${id}"`), id);
  });
  it('choosing the type reveals the picker, pre-fills the amount with the down payment asked, and shows "Down payment asked"; typing your own keeps it', async () => {
    const e = env(SALES, withCo());
    const p = await recSheet(e);
    assert.match(p.$('pr-due').textContent, /Balance due ₱35,000\.00/);
    p.$('pr-type').value = 'change_order'; await p.$('pr-type').fire('change');
    assert.ok(!p.$('pr-co-wrap').classList.contains('hidden')); assert.equal(p.$('pr-amount').value, '9000'); assert.match(p.$('pr-due').textContent, /Down payment asked ₱9,000\.00/);
    p.$('pr-amount').value = '4000'; await p.$('pr-amount').fire('input'); p.$('pr-type').value = 'balance'; await p.$('pr-type').fire('change'); p.$('pr-type').value = 'change_order'; await p.$('pr-type').fire('change');
    assert.equal(p.$('pr-amount').value, '4000', 'a typed amount is not overwritten');
    p.$('pr-type').value = 'balance'; await p.$('pr-type').fire('change');
    assert.ok(p.$('pr-co-wrap').classList.contains('hidden'));
  });
  it('records it: a pending claim of kind change_order with changeOrderId, the order and job, clientId; Neil and Finance told; Production not', async () => {
    const e = env(SALES, withCo());
    const p = await recSheet(e);
    p.$('pr-type').value = 'change_order'; await p.$('pr-type').fire('change');
    await submit(e, p);
    assert.equal(e.claims().length, 1, e.toastMsgs().join('|'));
    const c = e.claims()[0][1];
    assert.equal(c.kind, 'change_order'); assert.equal(c.changeOrderId, 'cr1'); assert.equal(c.orderId, 'so1'); assert.equal(c.projectId, 'prj1'); assert.equal(c.clientId, 'c1'); assert.equal(c.paymentReceived, 9000); assert.equal(c.status, 'pending'); assert.equal(c.siteVisitId, null);
    assert.ok(e.notifs.some((n) => n.kind === 'owner' && n.type === 'payment_confirm') && e.notifs.some((n) => n.kind === 'dept' && n.dept === 'Finance')); assert.ok(!e.notifs.some((n) => n.dept === 'Production'));
    assert.equal(e.ledger().length, 0);
  });
  it('a balance or progress payment carries no change order', async () => {
    const e = env(SALES, withCo());
    const p = await recSheet(e);
    await submit(e, p, { amount: 1000 });
    assert.equal(e.claims()[0][1].changeOrderId, null);
  });
  it('with no signed change order waiting, the type is refused in plain words; a change order that is no longer waiting at save time is refused', async () => {
    const e = env(SALES, {});
    const p = await recSheet(e);
    p.$('pr-type').value = 'change_order'; await p.$('pr-type').fire('change');
    assert.match(p.$('pr-due').textContent, /No signed change order is waiting/);
    await submit(e, p, { amount: 1000 });
    assert.match(p.$('pr-err').textContent, /Choose the signed change order/); assert.equal(e.claims().length, 0);
    const e2 = env(SALES, withCo());
    const p2 = await recSheet(e2);
    p2.$('pr-type').value = 'change_order'; await p2.$('pr-type').fire('change');
    e2.db.store.change_orders.get('cr1').status = 'applied';
    await submit(e2, p2);
    assert.match(p2.$('pr-err').textContent, /no longer waiting for a down payment/); assert.equal(e2.claims().length, 0);
  });
  it('a FULLY PAID job (nothing owed) still takes the down payment — the ceiling is the balance PLUS the change order\'s price; one cent above it is refused', async () => {
    const paid = { pj: { amountCollected: 100000, arBalance: 0 } };
    const e = env(SALES, { ...withCo(), ...paid });
    const p = await recSheet(e);
    p.$('pr-type').value = 'change_order'; await p.$('pr-type').fire('change');
    await submit(e, p, { amount: 18000.51 });
    assert.match(p.$('pr-err').textContent, /more than the balance due/); assert.equal(e.claims().length, 0);
    const e2 = env(SALES, { ...withCo(), ...paid });
    const p2 = await recSheet(e2);
    p2.$('pr-type').value = 'change_order'; await p2.$('pr-type').fire('change');
    await submit(e2, p2, { amount: 9000 });
    assert.equal(e2.claims().length, 1, e2.toastMsgs().join('|'));
    // and a plain balance payment is still refused on a paid-up job
    const e3 = env(SALES, { ...paid }); await e3.ctx.PaymentClaimsUI.openRecordSheet({ orderId: 'so1' }); assert.equal(e3.pages.length, 0); assert.match(e3.toastMsgs().join('|'), /Nothing is owed/);
  });
  it('confirming it (President): one PAY- row, the job collected rises, the claim is recorded — judged against balance + the change order\'s price, even on a paid job', async () => {
    const e = env(PRES, { ...withCo({ claims: { cl1: coClaim() } }), pj: { amountCollected: 100000, arBalance: 0 } });
    await e.ctx.PaymentClaimsUI.openConfirmSheet({ id: 'cl1' });
    assert.match(e.lastPage().html, /balance due ₱18,000\.00 · balance after ₱9,000\.00/, 'the sheet judges it against balance + the change order\'s price too');
    await e.lastPage().$('pcc-confirm').click();
    assert.equal(e.ledger().length, 1, e.toastMsgs().join('|'));
    assert.equal(e.db.store.payment_claims.get('cl1').status, 'recorded'); assert.equal(e.pj().amountCollected, 109000); assert.equal(e.pj().arBalance, 0);
    const over = env(PRES, { ...withCo({ claims: { cl1: coClaim({ paymentReceived: 18001 }) } }), pj: { amountCollected: 100000, arBalance: 0 } });
    await over.ctx.PaymentClaimsUI.openConfirmSheet({ id: 'cl1' });
    await over.lastPage().$('pcc-confirm').click();
    assert.equal(over.ledger().length, 0); assert.match(over.lastPage().$('pcc-err').textContent, /more than the balance due/);
  });
  it('a change order that was APPLIED meanwhile is in the contract already: a late claim is judged on the balance alone (its price is not added twice)', async () => {
    const e = env(PRES, { requests: { cr1: request({ status: 'applied', appliedContractRev: 1 }) }, cos: { cr1: signedCo({ status: 'applied', appliedContractRev: 1 }) }, claims: { cl1: coClaim({ paymentReceived: 9000 }) }, so: { contractAmount: 118000 }, pj: { contractAmount: 118000, amountCollected: 118000, arBalance: 0 } });
    await e.ctx.PaymentClaimsUI.openConfirmSheet({ id: 'cl1' });
    assert.match(e.lastPage().html, /balance due ₱0\.00/);
    await e.lastPage().$('pcc-confirm').click();
    assert.equal(e.ledger().length, 0); assert.match(e.lastPage().$('pcc-err').textContent, /more than the balance due/);
  });
  it('a sent-back change-order claim is fixed and resent without changing its change order; its type cannot be switched to another family', async () => {
    const e = env(SALES, withCo({ claims: { cl1: coClaim({ status: 'payment_rejected', paymentConfirm: { decision: 'rejected', reason: 'wrong ref', decidedByName: 'Neil Barro', resubmits: 0 } }) } }));
    await e.ctx.PaymentClaimsUI.openRecordSheet({ claim: { id: 'cl1' } });
    const p = e.lastPage();
    assert.deepEqual([...p.html.matchAll(/<option value="([a-z_]+)"[^>]*>(?:Balance|Progress payment|Change-order down payment)<\/option>/g)].map((m) => m[1]), ['change_order']);
    assert.match(p.html, /id="pr-co"[^>]*disabled/);
    p.$('pr-ref').value = 'R-FIXED';
    await p.$('pr-save').click();
    const w = e.db.writes('payment_claims/cl1').filter((x) => x.op === 'update');
    assert.equal(w.length, 1);
    assert.ok(!('changeOrderId' in w[0].patch), 'the rules let Sales resend only the payment fields: the change order id is not written again');
    assert.equal(e.db.store.payment_claims.get('cl1').changeOrderId, 'cr1'); assert.equal(e.db.store.payment_claims.get('cl1').status, 'pending'); assert.equal(e.db.store.payment_claims.get('cl1').orRef, 'R-FIXED');
  });
});

// ═══ C5 / C6 — Choice C and the budget ═══════════════════════════════════════════════════════════════════════════════════════
const reviseSheet = async (e) => { await e.ctx.ContractUI.openReviseSheet({ id: 'so1' }); const p = e.lastPage(); assert.ok(p && p.$('rv-send'), 'the revise sheet opened: ' + e.toastMsgs().join('|')); return p; };
const sendC = async (e, reason = 'Signed change order CO-0004') => { const p = await reviseSheet(e); await p.check('rv-choice', 'change_order'); p.$('rv-reason').value = reason; await p.$('rv-send').click(); return p; };
const approve = async (e) => { const o = { id: 'so1', ...e.so() }; await e.ctx.ContractUI.applyRevision(o, () => {}); };
const ready = () => withCo({ claims: { cl1: coClaim({ status: 'recorded', recordedAmount: 9000 }) } });

describe('6. C5 / C6 — Choice C unlocks only with the signature AND the down payment; the apply adds half the price to the budget, once', () => {
  it('a signed change order whose down payment is NOT confirmed is listed but cannot be picked, with the reason; the choice itself is disabled', async () => {
    for (const claims of [{}, { cl1: coClaim() }, { cl1: coClaim({ status: 'payment_rejected' }) }, { cl1: coClaim({ status: 'recorded', recordedAmount: 4000 }) }]) {
      const e = env(PRES, withCo({ claims }));
      const p = await reviseSheet(e);
      assert.match(p.html, /waiting for the added down payment \(₱9,000\.00\)/); assert.match(p.html, /name="rv-co" value="cr1"[^>]*disabled/); assert.match(p.html, /id="rv-ch-c"[^>]*disabled/);
    }
  });
  it('once the down payment is confirmed (recorded amounts reach it) the change order is selectable and the sheet sends a change_order revision for current + price', async () => {
    const e = env(PRES, ready());
    const p = await reviseSheet(e);
    assert.doesNotMatch(p.html, /waiting for the added down payment/); assert.doesNotMatch(p.html, /id="rv-ch-c"[^>]*disabled/);
    await sendC(e);
    const pr = e.so().pendingRevision;
    assert.ok(pr, e.toastMsgs().join('|'));
    assert.equal(pr.kind, 'change_order'); assert.equal(pr.changeOrderId, 'cr1'); assert.equal(pr.fromAmount, 100000); assert.equal(pr.toAmount, 118000); assert.equal(pr.delta, 18000);
  });
  it('a sent-back change-order request whose change order is NOT ready any more cannot be sent again (nothing to pick); with two ready ones the request\'s own is the one checked', async () => {
    const prior = { revNo: 1, kind: 'change_order', fromAmount: 100000, toAmount: 118000, delta: 18000, changeReason: 'Signed change order', quoteId: null, quoteColl: null, quoteNumber: null, changeOrderId: 'cr1', gate: { approval: 'none', reason: '', lastApproved: 100000, stdTotal: null, collected: 65000 },
      status: 'rejected', requestedAt: '2026-11-19T01:00:00.000Z', requestedBy: 'u-sales', requestedByName: 'Uriel', resubmits: 0, prevReason: '', decision: 'rejected', decidedByName: 'Neil Barro', reason: 'not yet' };
    const e = env(PRES, withCo({ so: { pendingRevision: prior } }));      // its down payment is not in the books
    const p = await reviseSheet(e);
    await p.$('rv-send').click();
    assert.match(p.$('rv-err').textContent, /Choose or enter the new amount/); assert.equal(e.so().pendingRevision.status, 'rejected');
    const two = env(PRES, { requests: { cr1: request({ status: 'signed' }), cr2: request({ status: 'signed' }) }, cos: { cr1: signedCo({ pricing: { lines: [], price: 1000, addedDownPayment: 0 } }), cr2: signedCo({ coNumber: 'CO-0005', pricing: { lines: [], price: 2000, addedDownPayment: 0 } }) },
      so: { pendingRevision: { ...prior, changeOrderId: 'cr2', toAmount: 102000, delta: 2000 } } });
    const p2 = await reviseSheet(two);
    assert.match(p2.html, /name="rv-co" value="cr2" checked/); assert.doesNotMatch(p2.html, /name="rv-co" value="cr1" checked/);
  });
  it('a change order that asks for no down payment is ready as soon as it is signed', async () => {
    const e = env(PRES, withCo({ cos: { cr1: signedCo({ pricing: { lines: [], price: 5000, addedDownPayment: 0 } }) } }));
    const p = await reviseSheet(e);
    assert.doesNotMatch(p.html, /waiting for the added down payment/);
  });
  it('the apply (President): ONE SO-so1-R1 row for the difference, order contractRev 1, BOTH docs applied with appliedContractRev 1', async () => {
    const e = env(PRES, ready());
    await sendC(e); await approve(e);
    const rows = e.ledger();           // the confirmed down payment is seeded as a claim only, so the one ledger row here is the revision
    assert.equal(rows.length, 1, JSON.stringify(rows.map((x) => x[0])));
    assert.equal(rows[0][0], 'SO-so1-R1'); assert.equal(rows[0][1].amount, 18000);
    assert.equal(e.so().contractRev, 1); assert.equal(e.so().contractAmount, 118000); assert.equal(e.pj().contractAmount, 118000);
    assert.equal(e.co().status, 'applied'); assert.equal(e.co().appliedContractRev, 1); assert.equal(e.req().status, 'applied'); assert.equal(e.req().appliedContractRev, 1);
    assert.equal(e.so().revisions.length, 1); assert.equal(e.so().revisions[0].changeOrderId, 'cr1'); assert.equal(e.so().revisions[0].kind, 'change_order');
  });
  it('a change order not signed, or whose down payment is only pending, is refused AT THE APPLY with a plain message (nothing written)', async () => {
    const e = env(PRES, ready());
    await sendC(e);
    e.db.store.payment_claims.get('cl1').status = 'pending'; delete e.db.store.payment_claims.get('cl1').recordedAmount;
    await approve(e);
    assert.equal(e.ledger().length, 0); assert.equal(e.so().contractRev, undefined); assert.match(e.toastMsgs().join('|'), /not signed and paid yet/);
    e.db.store.payment_claims.get('cl1').status = 'recorded'; e.db.store.payment_claims.get('cl1').recordedAmount = 9000; e.db.store.change_orders.get('cr1').status = 'priced';
    await approve(e);
    assert.equal(e.ledger().length, 0); assert.equal(e.so().contractRev, undefined);
  });
  it('C6: job_money.budget.changeOrderAdds becomes HALF the price (18,000 -> 9,000), the change order is recorded as counted, and nothing else on the doc is invented', async () => {
    const e = env(PRES, ready());
    await sendC(e); await approve(e);
    const m = e.money();
    assert.ok(m, 'job_money/prj1 was written: ' + e.toastMsgs().join('|'));
    assert.equal(m.budget.changeOrderAdds, 9000); assert.deepEqual(m.budget.coApplied, ['cr1']); assert.ok(!('total' in m.budget) && !('base' in m.budget), 'no base yet, so no total');
    assert.ok(m.updatedAt);
  });
  it('C6 keeps an existing budget: base and source stay, the adds are added to, and the total follows (base + adds)', async () => {
    const e = env(PRES, { ...ready(), seed: { job_money: { prj1: { budget: { base: 60000, changeOrderAdds: 1000, total: 61000, source: 'typed', setBy: 'Neil Barro', coApplied: ['earlier'] }, closeout: { keep: 'me' } } } } });
    await sendC(e); await approve(e);
    const m = e.money();
    assert.equal(m.budget.base, 60000); assert.equal(m.budget.source, 'typed'); assert.equal(m.budget.changeOrderAdds, 10000); assert.equal(m.budget.total, 70000); assert.deepEqual(m.budget.coApplied, ['earlier', 'cr1']);
    assert.deepEqual(m.closeout, { keep: 'me' }, 'a merge-set leaves the other keys of the doc alone');
  });
  it('C6 with a NEGATIVE price lowers the budget by half (the mirror, SF20)', async () => {
    const neg = { pricing: { lines: [{ kind: 'removed', name: 'Table', qty: 1, unit: 'pc', unitPrice: 8000 }], price: -8000, addedDownPayment: 0 } };
    const e = env(PRES, { requests: { cr1: request({ status: 'signed', coNumber: 'CO-0004' }) }, cos: { cr1: signedCo(neg) }, seed: { job_money: { prj1: { budget: { base: 50000, changeOrderAdds: 0, total: 50000 } } } } });
    await sendC(e, 'Items removed'); await approve(e);
    assert.equal(e.so().contractAmount, 92000);
    assert.equal(e.money().budget.changeOrderAdds, -4000); assert.equal(e.money().budget.total, 46000);
  });
  it('a zero-price change order applies with no ledger row and adds nothing to the budget (but is counted)', async () => {
    const zero = { pricing: { lines: [{ kind: 'added', name: 'Shelf', qty: 1, unit: 'pc', unitPrice: 500 }, { kind: 'removed', name: 'Rack', qty: 1, unit: 'pc', unitPrice: 500 }], price: 0, addedDownPayment: 0 } };
    const e = env(PRES, { requests: { cr1: request({ status: 'signed', coNumber: 'CO-0004' }) }, cos: { cr1: signedCo(zero) } });
    await sendC(e, 'Swap at the same price');
    assert.ok(e.so().pendingRevision, e.toastMsgs().join('|')); assert.equal(e.so().pendingRevision.delta, 0);
    await approve(e);
    assert.equal(e.ledger().length, 0); assert.equal(e.so().contractRev, 1); assert.equal(e.so().contractAmount, 100000);
    assert.equal(e.co().status, 'applied'); assert.equal(e.money().budget.changeOrderAdds, 0); assert.deepEqual(e.money().budget.coApplied, ['cr1']);
  });
  it('the budget step runs once per change order: a second change order adds its own half, the first is not counted twice', async () => {
    const e = env(PRES, { requests: { cr1: request({ status: 'signed', coNumber: 'CO-0004' }), cr2: request({ status: 'signed', coNumber: 'CO-0005' }) },
      cos: { cr1: signedCo({ pricing: { lines: [], price: 18000, addedDownPayment: 0 } }), cr2: signedCo({ coNumber: 'CO-0005', pricing: { lines: [], price: 4000, addedDownPayment: 0 } }) } });
    await sendC(e); await approve(e);
    assert.equal(e.money().budget.changeOrderAdds, 9000);
    await e.ctx.ContractUI.openReviseSheet({ id: 'so1' });
    const p = e.lastPage(); await p.check('rv-choice', 'change_order'); await p.check('rv-co', 'cr2'); p.$('rv-reason').value = 'Second change order'; await p.$('rv-send').click();
    await approve(e);
    assert.equal(e.so().contractRev, 2); assert.equal(e.so().contractAmount, 122000);
    assert.equal(e.money().budget.changeOrderAdds, 11000); assert.deepEqual(e.money().budget.coApplied, ['cr1', 'cr2']);
  });
  it('a failure of the budget step NEVER undoes the apply: the revision stands, both docs are applied, Production is told', async () => {
    const e = env(PRES, ready());
    await sendC(e);
    e.ctx.db.runTransaction = async () => { throw new Error('job_money is unreachable'); };
    await approve(e);
    assert.equal(e.so().contractRev, 1); assert.equal(e.so().contractAmount, 118000); assert.ok(e.ledger().some(([id]) => id === 'SO-so1-R1'));
    assert.equal(e.co().status, 'applied'); assert.equal(e.req().status, 'applied');
    assert.equal(e.money(), undefined);
    assert.ok(e.notifs.some((n) => n.dept === 'Production' && n.type === 'contract_applied'));
  });
  it('Rene\'s block then reads "Applied — see JO R1" and never a price', async () => {
    const e = env(PRES, ready());
    await sendC(e); await approve(e);
    const prod = env(PROD, { requests: { cr1: e.req() }, cos: { cr1: e.co() } });
    const h = await draw(prod);
    assert.ok(h.innerHTML.includes('Applied — see JO R1')); assert.doesNotMatch(h.innerHTML, /₱|CO-0004|18,000/);
  });
});
