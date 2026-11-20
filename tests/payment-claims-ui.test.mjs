// tests/payment-claims-ui.test.mjs — P5 "the balance payment", the screens and their hooks (specs/SALES-FLOW-SPEC-2026-11-19.md §8, §9.8, §9.10, §10.2, §12, §13.2 Phase 4).
//
//   1. WIRING     sw.js precaches the core and the UI on their own lines; neither is an index.html script (lazy, CLAUDE.md "app-kit" rule); the hooks in
//                 departments.js, production.js and approvals.js are small, guarded and lazy; the two legacy 'Official Receipt' document tags are relabelled.
//   2. BEHAVIOUR  js/payment-claims-ui.js, js/payment-claims-core.js and js/sales-flow-core.js run for real in the shared Sales harness (in-memory Firestore,
//                 Ledger.post with the real contract, recorded toasts and notifications): record -> pending claim; over-balance and no-proof refused; confirm -> one
//                 PAY-<id> row, job collected / AR moved, claim recorded with a PA number; a double tap posts once; a stand-in confirms (onBehalf, Neil told) but
//                 never her own claim; send back and resend; legacy job keeps the old modal, a flow-2 job hides it; Production never sees a peso.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { PRES, SALES, FIN, MGR, PROD, makeBaseEnv, read, same, sliceOf } from './fixtures/sales-flow-harness.mjs';

const SW = read('sw.js'), DEPT = read('js/departments.js'), APPR = read('js/screens/approvals.js'), HTML = read('index.html');
const PRODSRC = read('js/screens/production.js'), UI = read('js/payment-claims-ui.js');

describe('1. wiring', () => {
  const precache = (() => { const m = SW.match(/const PRECACHE = \[([\s\S]*?)\n\];/); return [...m[1].matchAll(/^\s*'([^']+)',?\s*(?:\/\/.*)?$/gm)].map((x) => x[1]); })();
  it('sw.js precaches payment-claims-core and payment-claims-ui on their own lines, next to the contract lines', () => {
    const at = ['/js/contract-ui.js', '/js/payment-claims-core.js', '/js/payment-claims-ui.js'].map((f) => precache.indexOf(f));
    assert.ok(at.every((i) => i >= 0), String(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    for (const f of ['/js/payment-claims-core.js', '/js/payment-claims-ui.js']) assert.ok(SW.includes(`\n  '${f}',\n`), f);
  });
  it('payment-claims-ui is LAZY: not an index.html script, not in the app kit; it loads its own core on demand', () => {
    assert.doesNotMatch(HTML, /payment-claims-ui\.js/);
    assert.doesNotMatch(HTML, /payment-claims-core\.js/);
    assert.match(UI, /ensureScript\('js\/payment-claims-core\.js'\)/);
  });
  it('the Sales Orders hooks are guarded, lazy and gated: Sales + President, confirmed flow-2 order, job not paid / cancelled, balance > 0', () => {
    assert.match(DEPT, /try \{ const _pj2 = o\.projectId \? projById\[o\.projectId\] : null; if \(o\.status === 'recorded' && o\.flowVersion === 2 && \(isSalesActor \|\| isPres\) && _pj2 && !\['paid','cancelled'\]\.includes\(_pj2\.stage\)/);
    assert.match(DEPT, /so-recpay-btn/);
    assert.match(DEPT, /ensureScript\('js\/payment-claims-ui\.js'\); await window\.PaymentClaimsUI\.openRecordSheet\(\{ orderId: o\.id \}, rerender\)/);
    assert.match(DEPT, /try \{ if \(c\.querySelector\('\.so-claims'\)\) window\.ensureScript\('js\/payment-claims-ui\.js'\)/);
  });
  it('the dashboard count reads payment_claims where status == pending, through the cache, and a failed read is "none"', () => {
    const fn = sliceOf(DEPT, 'async function _loadPendingPaymentClaims(){', 'window.renderPaymentConfirmList');
    assert.match(fn, /db\.collection\('payment_claims'\)\.where\('status', '==', 'pending'\)\.orderBy\('createdAt', 'desc'\)/);
    assert.match(fn, /catch \(e\) \{ return \[\]; \}/);
    assert.match(fn, /\(await _loadPendingPaymentConfirmations\(\)\)\.concat\(await _loadPendingPaymentClaims\(\)\)/);
  });
  it('Approvals: one host div + one guarded lazy call, right after the contract-change ones', () => {
    assert.equal((APPR.match(/id="approvals-payclaims"/g) || []).length, 1);
    assert.match(APPR, /try \{ window\.ensureScript\('js\/payment-claims-ui\.js'\)\.then\(\(\) => window\.PaymentClaimsUI\.renderDecisionBlock\(/);
    assert.ok(APPR.indexOf('id="approvals-payclaims"') > APPR.indexOf('id="approvals-contractchange"'));
    assert.ok(APPR.indexOf("ensureScript('js/payment-claims-ui.js')") > APPR.indexOf("ensureScript('js/contract-ui.js')"));
  });
  it('production.js: the old books-tier "Record Payment" button is hidden from flowVersion >= 2; both legacy tags say Payment Acknowledgement (§9.8)', () => {
    assert.match(PRODSRC, /_isFinAdmin\(\)&&!isBsOnlyU&&!\(Number\(p\.flowVersion\)>=2\)\?`<button class="btn-primary" id="proj-bill-btn">/);
    for (const [name, src] of [['production.js', PRODSRC], ['departments.js', DEPT]]) {
      assert.doesNotMatch(src, /type:\s*'Official Receipt'/, name);
      assert.match(src, /type:'Payment Acknowledgement', ref:orRef\|\|/, name);
    }
  });
  it('production.js: the form buttons are lazy and silent, five forms by Forms.buttonHtml, and the payment block is for money viewers only', () => {
    for (const id of ['qc_checklist', 'installation_checklist', 'punch_list', 'client_acceptance']) assert.ok(PRODSRC.includes(`'${id}'`), id);
    assert.match(PRODSRC, /F\.buttonHtml\('delivery_receipt', \{ docId: order\.id, projectId: order\.projectId \|\| null \}/);
    assert.match(PRODSRC, /\(showMoney && !isBsOnlyU && Number\(p\.flowVersion\)>=2 && p\.salesOrderId\)\?'<div id="jpd-payments"><\/div>':''/);
    assert.doesNotMatch(PRODSRC, /Payment Acknowledgement[\s\S]{0,40}jpd-forms/);
  });
  it('no notification goes to Production, and every dynamic value in an HTML string goes through esc() or money()', () => {
    assert.doesNotMatch(UI, /sendToDept\('Production'/);
    assert.doesNotMatch(UI, /innerHTML\s*=\s*[^;]*\$\{/);
    assert.doesNotMatch(UI, /toast\([^)]*<[a-z]/);
    assert.doesNotMatch(UI, /Official Receipt|Sales Invoice/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
const order = (o = {}) => ({ projectId: 'prj1', quoteId: 'q1', quoteNumber: 'BK-1', soNumber: 'SO-0012', clientId: 'c1', clientName: 'Acme Foods', company: 'BK', contractAmount: 100000, paymentReceived: 65000, recordedAmount: 65000, vatTreatment: 'inclusive', status: 'recorded', flowVersion: 2, createdBy: 'u-sales', createdByName: 'Uriel', ...o });
const project = (o = {}) => ({ projectNo: 'JP-1', salesOrderId: 'so1', clientId: 'c1', clientName: 'Acme Foods', stage: 'in_production', contractAmount: 100000, amountCollected: 65000, arBalance: 35000, flowVersion: 2, payments: [{ amount: 65000, date: '2026-11-18' }], documents: [], timeline: [], ...o });
const claim = (o = {}) => ({ kind: 'balance', orderId: 'so1', projectId: 'prj1', quoteNumber: 'BK-1', clientId: 'c1', clientName: 'Acme Foods', company: 'BK', paymentReceived: 35000, paymentMethod: 'GCash', vatTreatment: 'inclusive', orRef: 'REF-9', paymentDate: '2026-11-19', receiptUrl: 'https://r.example/p.pdf', receiptName: 'p.pdf', status: 'pending', paymentConfirm: { requestedAt: '2026-11-19T01:00:00.000Z', requestedBy: 'u-sales', requestedByName: 'Uriel', decision: null, resubmits: 0 }, createdBy: 'u-sales', createdByName: 'Uriel', createdAt: { seconds: 10, toDate: () => new Date(10000) }, ...o });

function makeForms() {
  const f = { counter: 0, numbers: [], failNumber: false };
  f.nextNumber = async (s) => { if (f.failNumber) throw new Error('counter down'); f.counter++; const n = `${s}-${String(f.counter).padStart(4, '0')}`; f.numbers.push(n); return n; };
  f.buttonHtml = (id, ref, o) => `<button type="button" data-form="${id}" data-ref='${JSON.stringify(ref)}'>${(o && o.label) || id}</button>`;
  f.bind = () => {};
  return f;
}
function env(who, { so = {}, pj = {}, claims = {}, seed = {}, banks = [], ...opts } = {}) {
  const forms = makeForms();
  const e = makeBaseEnv(who, { seed: { sales_orders: { so1: order(so) }, job_projects: { prj1: project(pj) }, payment_claims: claims, ...seed }, banks, forms, ...opts });
  const c = e.ctx;
  c.canEditDept = (d) => who.role === 'president' || (who.depts || []).includes(d);
  c.flowForms = () => c.ensureScript('js/forms.js').then(() => c.Forms);
  e.load(read('js/payment-claims-core.js'), 'js/payment-claims-core.js');
  e.load(read('js/payment-claims-ui.js'), 'js/payment-claims-ui.js');
  e.UI = c.PaymentClaimsUI;
  e.fakeForms = forms;
  e.so = () => e.db.store.sales_orders.get('so1');
  e.pj = () => e.db.store.job_projects.get('prj1');
  e.claims = () => [...(e.db.store.payment_claims || new Map()).entries()];
  e.claim = (id) => e.db.store.payment_claims.get(id);
  e.ledger = () => [...(e.db.store.ledger || new Map()).entries()];
  return e;
}
const record = async (e, { amount = '35000', type, method, vat, ref = 'REF-9', receipt = true, date } = {}) => {
  await e.UI.openRecordSheet({ orderId: 'so1' });
  const p = e.lastPage();
  assert.ok(p && p.$('pr-amount'), 'the record sheet opened: ' + e.toastMsgs().join('|'));
  p.$('pr-amount').value = String(amount);
  if (type) p.$('pr-type').value = type;
  if (method) p.$('pr-method').value = method;
  if (vat) p.$('pr-vat').value = vat;
  if (date) p.$('pr-date').value = date;
  p.$('pr-ref').value = ref;
  if (receipt) e.uploads['pr-upload'].cb({ url: 'https://r.example/proof.pdf', name: 'proof.pdf' });
  await p.$('pr-save').click();
  return p;
};
const confirmSheet = async (e, id = 'cl1') => { await e.UI.openConfirmSheet({ id }); return e.lastPage(); };
const tap = async (e, id = 'cl1') => { const p = await confirmSheet(e, id); assert.ok(p && p.$('pcc-confirm'), 'the confirm sheet opened: ' + e.toastMsgs().join('|')); await p.$('pcc-confirm').click(); return p; };
const withClaim = (o) => ({ claims: { cl1: claim(o) } });

describe('2. record a later payment (§8.1, P-1)', () => {
  it('writes a pending payment_claims doc in the §10.2 shape (QF field names), and nothing else', async () => {
    const e = env(SALES);
    await record(e, { amount: '35000', method: 'Bank Transfer', ref: 'BT-1', date: '2026-11-19' });
    assert.equal(e.claims().length, 1, e.toastMsgs().join('|'));
    const c = e.claims()[0][1];
    assert.equal(c.kind, 'balance'); assert.equal(c.status, 'pending');
    assert.equal(c.orderId, 'so1'); assert.equal(c.projectId, 'prj1'); assert.equal(c.clientId, 'c1'); assert.equal(c.clientName, 'Acme Foods'); assert.equal(c.company, 'BK'); assert.equal(c.quoteNumber, 'BK-1');
    assert.equal(c.paymentReceived, 35000); assert.equal(c.paymentMethod, 'Bank Transfer'); assert.equal(c.vatTreatment, 'inclusive'); assert.equal(c.orRef, 'BT-1'); assert.equal(c.paymentDate, '2026-11-19');
    assert.equal(c.receiptUrl, 'https://r.example/proof.pdf'); assert.equal(c.receiptName, 'proof.pdf');
    assert.equal(c.createdBy, 'u-sales'); assert.equal(c.createdByName, 'Uriel'); assert.ok(c.createdAt && c.updatedAt);
    assert.equal(c.paymentConfirm.decision, null); assert.equal(c.paymentConfirm.resubmits, 0); assert.equal(c.paymentConfirm.requestedBy, 'u-sales');
    for (const k of ['siteVisitId', 'changeOrderId', 'area']) assert.ok(k in c, k);
    for (const k of ['recordedAmount', 'recordedAt', 'recordedBy', 'paNumber', 'bankAccountId']) assert.ok(!(k in c), `a pending claim has no ${k}`);
    assert.equal(e.ledger().length, 0, 'recording writes no money');
    assert.equal(e.pj().amountCollected, 65000); assert.equal(e.so().recordedAmount, 65000);
    assert.ok(e.notifs.some((n) => n.kind === 'owner' && n.type === 'payment_confirm' && n.dedupKey === `payconf-claim-${e.claims()[0][0]}-0`), 'Neil is told');
    assert.ok(e.notifs.some((n) => n.kind === 'dept' && n.dept === 'Finance'), 'Finance gets the FYI');
    assert.ok(!e.notifs.some((n) => n.dept === 'Production'), 'Production is not told');
  });
  it('the three types are offered, the VAT treatment is pre-set from the order, and the sheet shows "Balance due"', async () => {
    const e = env(SALES, { so: { vatTreatment: 'exempt' } });
    await e.UI.openRecordSheet({ orderId: 'so1' });
    const p = e.lastPage();
    assert.match(p.html, /Balance due ₱35,000\.00/);
    for (const k of ['balance', 'progress', 'change_order']) assert.ok(p.html.includes(`value="${k}"`), k);
    assert.equal(p.$('pr-vat').value, 'exempt');
    assert.equal(p.$('pr-type').value, 'balance');
    const e2 = env(SALES);
    await record(e2, { amount: '1000', type: 'progress' });
    assert.equal(e2.claims()[0][1].kind, 'progress');
  });
  it('refuses more than the balance due (+₱0.50): 35000.50 passes, 35000.51 does not; nothing is written', async () => {
    const e = env(SALES);
    const p = await record(e, { amount: '35000.51' });
    assert.equal(e.claims().length, 0);
    assert.match(p.$('pr-err').textContent, /more than the balance due/);
    assert.match(p.$('pr-err').textContent, /₱35,000\.00/);
    assert.ok(!p.$('pr-err').classList.contains('hidden'));
    const e2 = env(SALES);
    await record(e2, { amount: '35000.50' });
    assert.equal(e2.claims().length, 1);
  });
  it('the balance is read FRESH at save: a contract decrease made while the sheet was open refuses it', async () => {
    const e = env(SALES);
    await e.UI.openRecordSheet({ orderId: 'so1' });
    const p = e.lastPage();
    e.db.store.job_projects.get('prj1').arBalance = 10000;           // the contract went down while the sheet was open
    p.$('pr-amount').value = '35000'; p.$('pr-ref').value = 'x';
    e.uploads['pr-upload'].cb({ url: 'https://r.example/p.pdf', name: 'p.pdf' });
    await p.$('pr-save').click();
    assert.equal(e.claims().length, 0);
    assert.match(p.$('pr-err').textContent, /more than the balance due/);
  });
  it('proof is REQUIRED; so is an amount', async () => {
    const e = env(SALES);
    const p = await record(e, { amount: '1000', receipt: false });
    assert.equal(e.claims().length, 0);
    assert.match(p.$('pr-err').textContent, /receipt or proof/i);
    const p2 = await record(env(SALES), { amount: '' });
    assert.match(p2.$('pr-err').textContent, /amount/i);
  });
  it('who may record: Sales, the President and the books tier; not Production, not a secretary; a legacy job, an unconfirmed order or a paid-up job is refused', async () => {
    const prod = env(PROD); await prod.UI.openRecordSheet({ orderId: 'so1' });
    assert.equal(prod.pages.length, 0); assert.match(prod.toastMsgs().join('|'), /Only Sales or the President/);
    const sec = env({ role: 'secretary', depts: ['Sales'], uid: 'u-sec', name: 'Sec' }); await sec.UI.openRecordSheet({ orderId: 'so1' });
    assert.equal(sec.pages.length, 0);
    for (const who of [SALES, PRES, FIN]) { const e = env(who); await e.UI.openRecordSheet({ orderId: 'so1' }); assert.equal(e.pages.length, 1, who.name); }
    const legacy = env(SALES, { so: { flowVersion: undefined }, pj: { flowVersion: undefined } }); await legacy.UI.openRecordSheet({ orderId: 'so1' });
    assert.equal(legacy.pages.length, 0); assert.match(legacy.toastMsgs().join('|'), /old payment screen/);
    const unconf = env(SALES, { so: { status: 'pending' } }); await unconf.UI.openRecordSheet({ orderId: 'so1' });
    assert.equal(unconf.pages.length, 0); assert.match(unconf.toastMsgs().join('|'), /not confirmed/);
    const paid = env(SALES, { pj: { arBalance: 0, amountCollected: 100000, stage: 'paid' } }); await paid.UI.openRecordSheet({ orderId: 'so1' });
    assert.equal(paid.pages.length, 0); assert.match(paid.toastMsgs().join('|'), /Nothing is owed/);
  });
  it('opened from the job (projectId) finds the order through salesOrderId', async () => {
    const e = env(SALES);
    await e.UI.openRecordSheet({ projectId: 'prj1' });
    assert.equal(e.pages.length, 1);
  });
  it('a site-visit fee already paid for this client comes off the balance due', async () => {
    const e = env(SALES, { claims: { fee1: claim({ kind: 'site_visit', status: 'recorded', recordedAmount: 1000, orderId: null, projectId: null }) } });
    await e.UI.openRecordSheet({ orderId: 'so1' });
    assert.match(e.lastPage().html, /Balance due ₱34,000\.00/);
  });
  it('the President who records a payment lands on the confirm sheet, REPLACING the record page (one more tap)', async () => {
    const e = env(PRES);
    await record(e, { amount: '35000' });
    assert.equal(e.claims().length, 1);
    const p = e.lastPage();
    assert.ok(p.$('pcc-confirm'), 'the confirm sheet is the last page');
    assert.equal(p.opts && p.opts.replace, true);
    assert.equal(e.ledger().length, 0, 'still nothing posted until he taps');
  });
});

describe('3. confirm (§8.3, P-2): posts exactly once', () => {
  it('President confirms: ONE PAY-<id> ledger row, job collected / AR moved in the same call, claim recorded with a PA number, no stage', async () => {
    const e = env(PRES, withClaim());
    await tap(e);
    assert.equal(e.ledger().length, 1, e.toastMsgs().join('|'));
    const [id, row] = e.ledger()[0];
    assert.equal(id, 'PAY-cl1'); assert.equal(row.refNumber, 'PAY-cl1'); assert.equal(row.amount, 35000); assert.equal(row.type, 'credit'); assert.equal(row.source, 'Sales'); assert.equal(row.projectId, 'prj1');
    assert.equal(e.pj().amountCollected, 100000); assert.equal(e.pj().arBalance, 0);
    assert.ok(!('stage' in e.db.writes('job_projects/prj1').reduce((a, w) => Object.assign(a, w.patch || {}), {})), 'the plan never writes stage');
    assert.equal(e.pj().stage, 'in_production');
    const pay = e.pj().payments.find((x) => x.claimId === 'cl1');
    assert.ok(pay && pay.amount === 35000 && pay.type === 'Balance' && pay.ledgerId === 'PAY-cl1');
    assert.ok(e.pj().documents.some((d) => d.type === 'Payment Acknowledgement' && d.ref === 'PA-0001'));
    const c = e.claim('cl1');
    assert.equal(c.status, 'recorded'); assert.equal(c.recordedAmount, 35000); assert.equal(c.paNumber, 'PA-0001'); assert.ok(c.recordedAt); assert.equal(c.recordedBy, 'Neil Barro');
    assert.equal(c.paymentConfirm.decision, 'confirmed'); assert.equal(c.paymentConfirm.decidedBy, 'u-pres'); assert.equal(c.paymentConfirm.decidedByRole, 'president'); assert.equal(c.paymentConfirm.onBehalf, false);
    assert.ok(e.notifs.some((n) => n.kind === 'send' && n.to === 'u-sales' && n.type === 'payment_confirmed' && n.dedupKey === 'payok-claim-cl1'), 'Uriel is told');
    assert.ok(!e.notifs.some((n) => n.kind === 'owner'), 'Neil is not told about his own tap');
  });
  it('a bank account is required when the company has any; its tag rides on the ledger row and the claim', async () => {
    const e = env(PRES, { ...withClaim(), banks: [{ id: 'b1', nickname: 'BDO' }] });
    const p = await confirmSheet(e);
    p.$('pcc-bank').value = '';
    await p.$('pcc-confirm').click();
    assert.equal(e.ledger().length, 0);
    assert.match(p.$('pcc-err').textContent, /Select the company account/);
    p.$('pcc-bank').value = 'b1';
    await p.$('pcc-confirm').click();
    assert.equal(e.ledger().length, 1);
    assert.equal(e.ledger()[0][1].bankAccountId, 'b1');
    assert.equal(e.claim('cl1').bankAccountId, 'b1');
  });
  it('a double tap (one after the other) posts once and burns ONE Payment Acknowledgement number', async () => {
    const e = env(PRES, withClaim());
    const p = await confirmSheet(e);
    await p.$('pcc-confirm').click();
    await p.$('pcc-confirm').click();
    assert.equal(e.ledger().length, 1);
    assert.equal(e.pj().amountCollected, 100000);
    assert.equal(e.fakeForms.numbers.length, 1);
    assert.match(e.toastMsgs().join('|'), /already confirmed/);
  });
  it('two taps at the same instant still post once and move the job once', async () => {
    const e = env(PRES, withClaim());
    const p = await confirmSheet(e);
    await Promise.all([p.$('pcc-confirm').click(), p.$('pcc-confirm').click()]);
    assert.equal(e.ledger().length, 1);
    assert.equal(e.pj().amountCollected, 100000);
    assert.equal(e.pj().payments.filter((x) => x.claimId === 'cl1').length, 1);
    assert.equal(e.claim('cl1').status, 'recorded');
  });
  it('a retry after the claim patch failed repairs the claim only: the job is not incremented again', async () => {
    const e = env(PRES, withClaim());
    const real = e.db.collection.bind(e.db);
    let fail = true;
    e.db.collection = (name) => { const c = real(name); if (name !== 'payment_claims') return c; return { ...c, doc: (id) => { const d = c.doc(id); return { ...d, update: async (patch) => { if (fail && patch.status === 'recorded') { fail = false; throw new Error('network'); } return d.update(patch); } }; } }; };
    const p = await confirmSheet(e);
    await p.$('pcc-confirm').click();
    assert.equal(e.ledger().length, 1); assert.equal(e.claim('cl1').status, 'pending', 'the patch failed');
    assert.equal(e.pj().amountCollected, 100000);
    await p.$('pcc-confirm').click();
    assert.equal(e.ledger().length, 1); assert.equal(e.pj().amountCollected, 100000, 'job incremented once');
    assert.equal(e.claim('cl1').status, 'recorded'); assert.equal(e.claim('cl1').recordedAmount, 35000);
  });
  it('a failed numbering stops BEFORE the post: nothing written, an error shown', async () => {
    const e = env(PRES, withClaim());
    e.fakeForms.failNumber = true;
    const p = await tap(e);
    assert.equal(e.ledger().length, 0); assert.equal(e.claim('cl1').status, 'pending');
    assert.match(p.$('pcc-err').textContent, /could not be numbered/);
  });
  it('an amount above the FRESH balance (contract decreased since it was recorded) is refused; nothing is written', async () => {
    const e = env(PRES, withClaim());
    const p = await confirmSheet(e);
    e.db.store.job_projects.get('prj1').arBalance = 10000; e.db.store.job_projects.get('prj1').contractAmount = 75000;
    await p.$('pcc-confirm').click();
    assert.equal(e.ledger().length, 0); assert.equal(e.pj().amountCollected, 65000); assert.equal(e.claim('cl1').status, 'pending');
    assert.match(p.$('pcc-err').textContent, /more than the balance due/);
  });
  it('a Finance stand-in confirms: stamp has onBehalf + role finance, Neil is notified; Production is not', async () => {
    const e = env(FIN, withClaim());
    const p = await confirmSheet(e);
    assert.match(p.html, /President normally confirms payments/);
    await p.$('pcc-confirm').click();
    assert.equal(e.ledger().length, 1);
    const pcn = e.claim('cl1').paymentConfirm;
    assert.equal(pcn.onBehalf, true); assert.equal(pcn.decidedByRole, 'finance'); assert.equal(pcn.decidedBy, 'u-fin'); assert.equal(pcn.decidedByName, 'Shaira');
    const own = e.notifs.find((n) => n.kind === 'owner');
    assert.ok(own && /confirmed by Shaira/.test(own.title) && own.dedupKey === 'payown-claim-cl1');
    assert.ok(e.notifs.some((n) => n.kind === 'dept' && n.dept === 'Finance'));
    assert.ok(!e.notifs.some((n) => n.dept === 'Production'));
  });
  it('a stand-in cannot confirm her OWN claim: the sheet does not open and nothing posts; the President can', async () => {
    const e = env(FIN, withClaim({ createdBy: 'u-fin', createdByName: 'Shaira' }));
    await e.UI.openConfirmSheet({ id: 'cl1' });
    assert.equal(e.pages.length, 0); assert.match(e.toastMsgs().join('|'), /cannot confirm/);
    assert.equal(e.ledger().length, 0);
    const e2 = env(PRES, withClaim({ createdBy: 'u-fin', createdByName: 'Shaira' }));
    await tap(e2);
    assert.equal(e2.ledger().length, 1);
  });
  it('Sales, a manager and Production cannot confirm', async () => {
    for (const who of [SALES, MGR, PROD]) {
      const e = env(who, withClaim());
      await e.UI.openConfirmSheet({ id: 'cl1' });
      assert.equal(e.pages.length, 0, who.name); assert.equal(e.ledger().length, 0);
    }
  });
  it('a sent-back or already-recorded claim cannot be confirmed', async () => {
    const e = env(PRES, withClaim({ status: 'payment_rejected' }));
    await e.UI.openConfirmSheet({ id: 'cl1' });
    assert.equal(e.pages.length, 0); assert.equal(e.ledger().length, 0);
    const e2 = env(PRES, withClaim({ status: 'recorded', recordedAmount: 35000, paNumber: 'PA-0007' }));
    await e2.UI.openConfirmSheet({ id: 'cl1' });
    assert.equal(e2.pages.length, 0); assert.equal(e2.ledger().length, 0);
  });
  it('Production never sees a peso: the timeline event and the document are the kinds production.js hides from Production-only viewers; nothing is sent to Production', async () => {
    const e = env(PRES, withClaim());
    await tap(e);
    const ev = e.pj().timeline.find((t) => /confirmed by/.test(t.event));
    assert.ok(ev && /₱/.test(ev.event), 'the timeline event carries the peso (hidden by the existing filter)');
    const doc = e.pj().documents.find((d) => d.type === 'Payment Acknowledgement');
    // the real filters, copied from production.js (visTimeline / visDocs) and run with showMoney = false
    const timelineFilter = PRODSRC.match(/const visTimeline = .*?\.filter\(t => showMoney \|\| !\/₱\/\.test\(t\.event\|\|''\)\);/);
    assert.ok(timelineFilter, 'production.js still filters ₱ events for Production');
    const docFilter = PRODSRC.match(/const visDocs = \(p\.documents\|\|\[\]\)\.filter\(dc => showMoney \|\| !\((\/[^\n]*?\/i)\.test\(dc\.type\|\|''\) \|\| \/₱\/\.test\(dc\.ref\|\|''\)\)\);/);
    assert.ok(docFilter, 'production.js still filters money documents for Production');
    const re = vm.runInNewContext(docFilter[1]);
    assert.ok(re.test(doc.type), 'the Payment Acknowledgement row is hidden from Production');
    assert.ok(!e.notifs.some((n) => n.dept === 'Production' || /Production/.test(String(n.to || ''))));
  });
});

describe('4. send back and resend (P-3, P-4)', () => {
  const sendBack = async (e, id = 'cl1') => { const p = await confirmSheet(e, id); await p.$('pcc-reject').click(); return p; };
  it('send back: status payment_rejected with the reason and the stamp, nothing posted, Uriel told; a stand-in also tells Neil', async () => {
    const e = env(PRES, withClaim());
    await sendBack(e);
    const c = e.claim('cl1');
    assert.equal(c.status, 'payment_rejected'); assert.equal(c.paymentConfirm.decision, 'rejected'); assert.equal(c.paymentConfirm.reason, 'amount does not match the receipt'); assert.equal(c.paymentConfirm.decidedBy, 'u-pres');
    assert.equal(e.ledger().length, 0); assert.equal(e.pj().amountCollected, 65000);
    assert.ok(e.notifs.some((n) => n.kind === 'send' && n.to === 'u-sales' && n.type === 'payment_rejected' && n.dedupKey === 'payrej-claim-cl1-0'));
    const e2 = env(FIN, withClaim());
    await sendBack(e2);
    assert.ok(e2.notifs.some((n) => n.kind === 'owner' && n.type === 'payment_rejected'));
    assert.equal(e2.claim('cl1').paymentConfirm.onBehalf, true);
  });
  it('a cancelled prompt sends nothing back', async () => {
    const e = env(PRES, { ...withClaim(), promptAnswer: null });
    await sendBack(e);
    assert.equal(e.claim('cl1').status, 'pending');
  });
  it('Uriel fixes and resends: back to pending, resubmits + 1, the old reason kept, Neil asked again; then it can be confirmed', async () => {
    const e = env(SALES, withClaim({ status: 'payment_rejected', paymentConfirm: { requestedAt: 'x', requestedBy: 'u-sales', requestedByName: 'Uriel', decision: 'rejected', reason: 'wrong amount', resubmits: 0, decidedByName: 'Neil Barro' } }));
    await e.UI.openRecordSheet({ claim: { id: 'cl1' } });
    const p = e.lastPage();
    assert.match(p.html, /Sent back by Neil Barro: wrong amount/);
    p.$('pr-amount').value = '30000';
    await p.$('pr-save').click();
    const c = e.claim('cl1');
    assert.equal(c.status, 'pending'); assert.equal(c.paymentReceived, 30000); assert.equal(c.paymentConfirm.decision, null); assert.equal(c.paymentConfirm.resubmits, 1); assert.equal(c.paymentConfirm.prevReason, 'wrong amount');
    assert.equal(e.claims().length, 1, 'the same claim, not a new one');
    assert.ok(e.notifs.some((n) => n.kind === 'owner' && /corrected/.test(n.title) && n.dedupKey === 'payconf-claim-cl1-1'));
    const keys = Object.keys(e.db.writes('payment_claims/cl1').filter((w) => w.op === 'update').pop().patch).sort();
    for (const k of keys) assert.ok(['paymentReceived', 'paymentMethod', 'vatTreatment', 'orRef', 'paymentDate', 'receiptUrl', 'receiptName', 'kind', 'status', 'paymentConfirm', 'updatedAt'].includes(k), `${k} is a key the rules let Sales write`);
    const pres = env(PRES, { claims: { cl1: c } });
    await tap(pres);
    assert.equal(pres.claim('cl1').status, 'recorded'); assert.equal(pres.claim('cl1').recordedAmount, 30000);
  });
  it('a claim that is not sent back cannot be fixed, and a resend still needs the proof and the balance rule', async () => {
    const e = env(SALES, withClaim());
    await e.UI.openRecordSheet({ claim: { id: 'cl1' } });
    assert.equal(e.pages.length, 0);
    const e2 = env(SALES, withClaim({ status: 'payment_rejected', paymentConfirm: { decision: 'rejected', reason: 'r', resubmits: 0 } }));
    await e2.UI.openRecordSheet({ claim: { id: 'cl1' } });
    const p = e2.lastPage();
    p.$('pr-amount').value = '99999';
    await p.$('pr-save').click();
    assert.equal(e2.claim('cl1').status, 'payment_rejected');
    assert.match(p.$('pr-err').textContent, /more than the balance due/);
  });
});

describe('5. the lists and the Payment Acknowledgement', () => {
  it('Approvals block: the President sees pending claims; a stand-in does not see her own; Sales and everyone else get an empty host', async () => {
    const host = () => ({ innerHTML: '', querySelectorAll: () => [] });
    const seed = { claims: { a: claim(), b: claim({ createdBy: 'u-fin', createdByName: 'Shaira', clientName: 'Mine Co' }), c: claim({ status: 'recorded' }) } };
    const e = env(PRES, seed); const h = host();
    await e.UI.renderDecisionBlock(h);
    assert.match(h.innerHTML, /Later payments to confirm/); assert.match(h.innerHTML, /Acme Foods/); assert.match(h.innerHTML, /Mine Co/); assert.ok(!/recorded by Neil/.test(h.innerHTML));
    assert.equal((h.innerHTML.match(/pcu-open/g) || []).length, 2, 'two pending claims, the recorded one is not listed');
    const f = env(FIN, seed); const hf = host();
    await f.UI.renderDecisionBlock(hf);
    assert.equal((hf.innerHTML.match(/pcu-open/g) || []).length, 1); assert.ok(!/Mine Co/.test(hf.innerHTML));
    assert.match(hf.innerHTML, /President's stand-in/);
    for (const who of [SALES, PROD]) { const x = env(who, seed); const hx = host(); await x.UI.renderDecisionBlock(hx); assert.equal(hx.innerHTML, '', who.name); }
  });
  it('the dashboard count (window.pendingPaymentConfirmations) adds the pending claims to the pending orders', async () => {
    const FLOW = sliceOf(DEPT, '//  SALES FLOW — Record payment', '// vatSplit moved verbatim to js/money-core.js (v14 Wave 2 Batch A —');
    const e = makeBaseEnv(PRES, { seed: { sales_orders: { o1: order({ status: 'pending', createdBy: 'u-sales' }) }, payment_claims: { cl1: claim(), cl2: claim({ status: 'recorded' }) } } });
    e.load("'use strict';\n" + FLOW, 'js/departments.js (flow region)');
    const list = await e.ctx.window.pendingPaymentConfirmations();
    assert.equal(list.length, 2, 'one pending order + one pending claim');
    assert.ok(list.some((x) => x.id === 'cl1') && list.some((x) => x.id === 'o1'));
  });
  it('a failed claims read leaves the order count intact', async () => {
    const FLOW = sliceOf(DEPT, '//  SALES FLOW — Record payment', '// vatSplit moved verbatim to js/money-core.js (v14 Wave 2 Batch A —');
    const e = makeBaseEnv(PRES, { seed: { sales_orders: { o1: order({ status: 'pending' }) } } });
    const real = e.db.collection.bind(e.db);
    e.db.collection = (n) => { if (n === 'payment_claims') throw new Error('permission-denied'); return real(n); };
    e.load("'use strict';\n" + FLOW, 'js/departments.js (flow region)');
    assert.equal((await e.ctx.window.pendingPaymentConfirmations()).length, 1);
  });
  it('a confirmed claim line offers the Payment Acknowledgement button (form payment_ack, with the claim id); a pending one does not', () => {
    const e = env(SALES);
    const v = { uid: 'u-sales', isPresident: false, isFinanceTier: false };
    const done = e.UI.claimLineHtml(Object.assign(claim({ status: 'recorded', recordedAmount: 35000, paNumber: 'PA-0003' }), { id: 'cl9' }), e.fakeForms, v);
    assert.match(done, /data-form="payment_ack"/); assert.match(done, /"claimId":"cl9"/); assert.match(done, /PA-0003/); assert.match(done, /Confirmed/);
    const pend = e.UI.claimLineHtml(Object.assign(claim(), { id: 'cl8' }), e.fakeForms, v);
    assert.ok(!/payment_ack/.test(pend)); assert.match(pend, /Awaiting confirmation/);
    const rej = e.UI.claimLineHtml(Object.assign(claim({ status: 'payment_rejected', paymentConfirm: { reason: 'bad <b>amount</b>' } }), { id: 'cl7' }), e.fakeForms, v);
    assert.match(rej, /pcu-line-fix/); assert.ok(!/<b>amount/.test(rej), 'the reason is escaped');
  });
  it('the job panel lists the down payment, the claims, the balance due, and Record payment for Sales; Production-only never gets the block', async () => {
    const e = env(SALES, { ...withClaim({ status: 'recorded', recordedAmount: 35000, paNumber: 'PA-0003' }), pj: { amountCollected: 100000, arBalance: 0 } });
    const host = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    await e.UI.renderJobPayments(host, Object.assign({ id: 'prj1' }, e.pj()), () => {});
    assert.match(host.innerHTML, /Down payment/); assert.match(host.innerHTML, /Balance/); assert.match(host.innerHTML, /PA-0003/);
    assert.ok(!/pcu-record/.test(host.innerHTML), 'no Record payment when nothing is owed');
    const e2 = env(SALES);
    const h2 = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    await e2.UI.renderJobPayments(h2, Object.assign({ id: 'prj1' }, e2.pj()), () => {});
    assert.match(h2.innerHTML, /pcu-record/); assert.match(h2.innerHTML, /Balance due <strong>₱35,000\.00/);
  });
});

describe('6. the production.js "Record Payment" modal: legacy keeps it, flow-2 hides it', () => {
  const cond = (() => {
    const line = PRODSRC.split('\n').find((l) => l.includes('id="proj-bill-btn"'));
    const m = line.match(/\$\{(.*?)\?`<button class="btn-primary" id="proj-bill-btn">/);
    assert.ok(m, 'the button condition could not be parsed');
    return m[1];
  })();
  const shown = (p, fin = true, bs = false) => vm.runInNewContext(`(${cond})`, { _isFinAdmin: () => fin, isBsOnlyU: bs, p });
  it('legacy job (no flowVersion): the books tier still gets the button', () => {
    assert.equal(!!shown({}), true); assert.equal(!!shown({ flowVersion: undefined }), true); assert.equal(!!shown({ flowVersion: 1 }), true); assert.equal(!!shown({ flowVersion: null }), true);
  });
  it('flowVersion 2 (and higher): hidden for everyone', () => {
    assert.equal(!!shown({ flowVersion: 2 }), false); assert.equal(!!shown({ flowVersion: 3 }), false); assert.equal(!!shown({ flowVersion: '2' }), false);
  });
  it('a non-books viewer never had it', () => { assert.equal(!!shown({}, false), false); });
});

describe('7. the Sales Orders page hooks (real renderSalesOrders)', () => {
  const FLOW = sliceOf(DEPT, '//  SALES FLOW — Record payment', '// vatSplit moved verbatim to js/money-core.js (v14 Wave 2 Batch A —');
  const PERMS = (() => { const a = DEPT.indexOf('function canEditDept(dept) {'); const b = DEPT.indexOf("function isFinancePriv() { return canEditDept('Finance'); }"); return DEPT.slice(a, b) + "function isFinancePriv() { return canEditDept('Finance'); }\n"; })();
  const page = async (who, { so = {}, pj = {} } = {}) => {
    const e = makeBaseEnv(who, { seed: { sales_orders: { so1: order({ createdAt: { seconds: 5, toDate: () => new Date(5000) }, ...so }) }, job_projects: { prj1: project(pj) } } });
    e.load("'use strict';\n" + PERMS + '\n' + FLOW, 'js/departments.js (flow region)');
    const c = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
    await e.ctx.window.renderSalesOrders(c);
    return c.innerHTML;
  };
  it('Sales and the President get "Record payment" on a confirmed flow-2 order with a balance, and the claims host', async () => {
    for (const who of [SALES, PRES]) { const h = await page(who); assert.match(h, /so-recpay-btn/, who.name); assert.match(h, /class="so-claims"/, who.name); }
  });
  it('not on a legacy order, a pending one, a paid-up job, a cancelled job; not for Finance', async () => {
    assert.doesNotMatch(await page(SALES, { so: { flowVersion: undefined } }), /so-recpay-btn/);
    assert.doesNotMatch(await page(SALES, { so: { status: 'pending' } }), /so-recpay-btn/);
    assert.doesNotMatch(await page(SALES, { pj: { arBalance: 0, amountCollected: 100000 } }), /so-recpay-btn/);
    assert.doesNotMatch(await page(SALES, { pj: { stage: 'paid', arBalance: 0 } }), /so-recpay-btn/);
    assert.doesNotMatch(await page(SALES, { pj: { stage: 'cancelled' } }), /so-recpay-btn/);
    assert.doesNotMatch(await page(FIN), /so-recpay-btn/);
    assert.match(await page(MGR), /so-recpay-btn/, 'a manager is a Sales actor through canEditDept, exactly as for "Revise contract amount"');
  });
  it('a legacy order carries no claims host', async () => {
    assert.doesNotMatch(await page(SALES, { so: { flowVersion: undefined } }), /so-claims/);
  });
});
