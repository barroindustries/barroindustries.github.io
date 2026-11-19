// tests/sales-flow-screens.test.mjs — the Sales flow SCREENS, run for real (specs/SALES-QUICK-FIXES-SPEC-2026-11-19.md §5.2–§5.5, §14).
//
// tests/sales-flow-core.test.mjs pins the pure rules. This file runs the REAL code of js/departments.js that wraps them — the
// Record payment modal, the Sales Orders page, the confirmation and rejection sheets, the "Payments to confirm" list, the
// Generate sheet, the Sales "Attach drawing" action and the two hand-off helpers — inside a vm, against an in-memory
// Firestore, a fake panel and recorded notifications. It exists to catch what a textual pin cannot: a typo in a handler, a
// write that happens in the wrong order, a button shown to the wrong person, money that moves twice.
//
// What is faked (and only that): Firestore (collections, where/orderBy/limit, set/update/add/delete, arrayUnion, server
// timestamps), the page chrome (openPage → a panel that finds ids in the HTML it was given), toasts and notifications,
// Ledger.post (same contract: deterministic id, dedupe, projectSync in the same call), BankAccounts, Drive's uploader.
//
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PRES, SALES, FIN, MGR, PROD, makeBaseEnv, read, same, sliceOf, salesAllowedKeys } from './fixtures/sales-flow-harness.mjs';

const DEPT = read('js/departments.js');

const slice = (from, to) => sliceOf(DEPT, from, to);
// the permission helpers (real), the whole Sales flow region (real), and the hand-off helpers (real)
const PERMS = (() => { const a = DEPT.indexOf('function canEditDept(dept) {'); const b = DEPT.indexOf('function isFinancePriv() { return canEditDept(\'Finance\'); }'); return DEPT.slice(a, b) + "function isFinancePriv() { return canEditDept('Finance'); }"; })();
const FLOW = slice('//  SALES FLOW — Record payment', '// vatSplit moved verbatim to js/money-core.js (v14 Wave 2 Batch A —');
const HANDOFF = slice('function ensureProdHandoffFields(o){', '// bindQuoteActions — moved verbatim to js/screens/sales.js');

// the screen code under test: the permission helpers, the whole Sales flow region and the hand-off helpers, all REAL
function makeEnv(who, opts) {
  const env = makeBaseEnv(who, opts);
  env.load("'use strict';\n" + PERMS + '\n' + FLOW + '\n' + HANDOFF, 'js/departments.js (sales-flow region)');
  return env;
}

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────
const quote = (over = {}) => ({ quoteNumber: 'BK-260101-001', clientName: 'Acme Foods', company: 'BK', total: 100000, status: 'filed', createdBy: 'u-sales', rootQuoteId: 'q1', payment: { downPaymentMode: '50' }, items: [{ name: 'Table', qty: 2 }], ...over });
const pend = (over = {}) => ({
  projectId: 'prj1', quoteId: 'q1', quoteNumber: 'BK-260101-001', clientName: 'Acme Foods', company: 'BK', project: 'Acme Foods — BK-260101-001',
  contractAmount: 100000, paymentReceived: 65000, paymentMethod: 'GCash', vatTreatment: 'inclusive', orRef: 'OR-77', paymentDate: '2026-11-18',
  receiptUrl: 'https://r.example/1.pdf', receiptName: '1.pdf', status: 'pending', flowVersion: 2, items: [{ name: 'Table', qty: 2 }],
  paymentConfirm: { requestedAt: '2026-11-18T01:00:00.000Z', requestedBy: 'u-sales', requestedByName: 'Uriel', decision: null, resubmits: 0 },
  createdBy: 'u-sales', createdByName: 'Uriel', createdAt: { seconds: 10, toDate: () => new Date(10000) }, trackingToken: 'tok1', ...over,
});
const proj = (over = {}) => ({ projectNo: 'JP-2611-001', stage: 'won', contractAmount: 100000, amountCollected: 0, arBalance: 100000, flowVersion: 2, documents: [], timeline: [], payments: [], ...over });
const dataset = { id: 'q1', qno: 'BK-260101-001', client: 'Acme Foods', clientId: '', total: '100000', co: 'BK' };
const container = () => ({ innerHTML: '', querySelectorAll: () => [], querySelector: () => null });
async function renderOrders(env) { const c = container(); await env.ctx.window.renderSalesOrders(c); return c.innerHTML; }
const rowOf = (html, clientName) => html.split('<tr class="so-row">').slice(1).find((r) => r.includes(clientName)) || '';
const has = (s, cls) => s.includes(cls);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the Sales Orders page: who sees which button in which state (§5.3, §14.2.3)', () => {
  const rows = {
    awaiting: pend({ clientName: 'AWAIT Co' }),
    mineFin: pend({ clientName: 'FINMINE Co', createdBy: 'u-fin', createdByName: 'Shaira' }),
    rejected: pend({ clientName: 'REJ Co', status: 'payment_rejected', paymentConfirm: { decision: 'rejected', reason: 'amount does not match the receipt', resubmits: 0, decidedByName: 'Neil Barro' } }),
    confirmed: pend({ clientName: 'CONF Co', status: 'recorded', recordedAmount: 65000 }),
    confirmedByFin: pend({ clientName: 'BYFIN Co', status: 'recorded', recordedAmount: 65000, paymentConfirm: { decision: 'confirmed', onBehalf: true, decidedByName: 'Shaira' } }),
    legacyConfirmed: pend({ clientName: 'LEGC Co', flowVersion: undefined, status: 'recorded', recordedAmount: 65000 }),
    legacyPending: pend({ clientName: 'LEGP Co', flowVersion: undefined, paymentConfirm: undefined }),
    design: pend({ clientName: 'DSGN Co', status: 'recorded', sentToDesign: true, recordedAmount: 65000 }),
    prod: pend({ clientName: 'PROD Co', status: 'recorded', sentToProduction: true, sentToDesign: true, recordedAmount: 65000 }),
  };
  const seed = () => ({ sales_orders: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v])), job_projects: { prj1: proj() } });
  const page = async (who) => renderOrders(makeEnv(who, { seed: seed() }));

  it('the President: Confirm + Reject on an awaiting order (no Edit on somebody else\'s), Generate when confirmed, Attach drawing and Job Order after', async () => {
    const h = await page(PRES);
    const a = rowOf(h, 'AWAIT Co');
    assert.ok(has(a, 'so-confirm-btn') && has(a, 'so-reject-btn'));
    assert.ok(!has(a, 'so-editpay-btn'), 'the President decides, he does not edit another person\'s payment');
    assert.ok(has(rowOf(h, 'CONF Co'), 'so-generate-btn'));
    assert.ok(has(rowOf(h, 'DSGN Co'), 'so-attach-btn'));
    assert.ok(has(rowOf(h, 'PROD Co'), 'so-jo-btn'));
    assert.ok(has(a, 'so-del-btn'), 'the President keeps the delete button');
  });
  it('Sales (employee + Sales dept): Edit payment on an awaiting order, Fix & resubmit on a rejected one, Generate when confirmed — never Confirm / Reject', async () => {
    const h = await page(SALES);
    const a = rowOf(h, 'AWAIT Co');
    assert.ok(has(a, 'so-editpay-btn') && !has(a, 'so-confirm-btn') && !has(a, 'so-reject-btn'));
    const r = rowOf(h, 'REJ Co');
    assert.ok(has(r, 'so-editpay-btn') && r.includes('Fix &amp; resubmit'));
    assert.ok(r.includes('amount does not match the receipt'), 'the rejection reason is shown to Sales');
    assert.ok(has(rowOf(h, 'CONF Co'), 'so-generate-btn'));
    assert.ok(has(rowOf(h, 'DSGN Co'), 'so-attach-btn'), 'Sales can attach the drawing themselves while the order is with Design');
    assert.ok(has(rowOf(h, 'PROD Co'), 'so-jo-btn'));
    assert.ok(!has(a, 'so-del-btn'));
  });
  it('Finance (finance role): Confirm + Reject as the President\'s stand-in, but no Edit and no Generate (A1); not on an order she recorded', async () => {
    const h = await page(FIN);
    const a = rowOf(h, 'AWAIT Co');
    assert.ok(has(a, 'so-confirm-btn') && has(a, 'so-reject-btn'));
    assert.ok(!has(a, 'so-editpay-btn'));
    assert.ok(!has(rowOf(h, 'CONF Co'), 'so-generate-btn'));
    const mine = rowOf(h, 'FINMINE Co');
    assert.ok(!has(mine, 'so-confirm-btn') && !has(mine, 'so-reject-btn'), 'nobody but the President confirms a payment they recorded');
    assert.ok(mine.includes('You recorded this payment, so the President confirms it.'));
    assert.ok(!has(rowOf(h, 'DSGN Co'), 'so-attach-btn') && !has(rowOf(h, 'PROD Co'), 'so-jo-btn'), 'Finance has no Sales hand-off buttons');
  });
  it('a manager outside Finance is NOT the stand-in (the rules would allow it, the client does not offer it)', async () => {
    const h = await page(MGR);
    assert.ok(!has(rowOf(h, 'AWAIT Co'), 'so-confirm-btn'));
  });
  it('a Production-only viewer sees the list but no action button except the tracking link', async () => {
    const h = await page(PROD);
    for (const k of Object.keys(rows)) {
      const r = rowOf(h, { awaiting: 'AWAIT Co', mineFin: 'FINMINE Co', rejected: 'REJ Co', confirmed: 'CONF Co', confirmedByFin: 'BYFIN Co', legacyConfirmed: 'LEGC Co', legacyPending: 'LEGP Co', design: 'DSGN Co', prod: 'PROD Co' }[k]);
      for (const cls of ['so-confirm-btn', 'so-reject-btn', 'so-editpay-btn', 'so-generate-btn', 'so-attach-btn', 'so-jo-btn', 'so-record-btn', 'so-design-btn']) assert.ok(!has(r, cls), `${k}: ${cls}`);
      assert.ok(has(r, 'so-link-btn'));
    }
  });
  it('legacy orders keep their old buttons: Record Sale for a pending one, To Design for a confirmed one — to Finance only', async () => {
    const hf = await page(FIN);
    assert.ok(has(rowOf(hf, 'LEGP Co'), 'so-record-btn'));
    assert.ok(has(rowOf(hf, 'LEGC Co'), 'so-design-btn'));
    assert.ok(!has(rowOf(hf, 'LEGC Co'), 'so-generate-btn'));
    const hs = await page(SALES);
    assert.ok(!has(rowOf(hs, 'LEGP Co'), 'so-record-btn'));
    assert.ok(has(rowOf(hs, 'LEGC Co'), 'so-generate-btn'));
  });
  it('the state badge says what the order is, and Finance\'s stand-in confirmation is named on the row', async () => {
    const h = await page(PRES);
    assert.ok(rowOf(h, 'AWAIT Co').includes('Awaiting confirmation') && rowOf(h, 'AWAIT Co').includes('badge-orange'));
    assert.ok(rowOf(h, 'AWAIT Co').includes('unconfirmed'));
    assert.ok(rowOf(h, 'REJ Co').includes('Payment rejected') && rowOf(h, 'REJ Co').includes('badge-red'));
    assert.ok(rowOf(h, 'CONF Co').includes('Payment confirmed') && rowOf(h, 'CONF Co').includes('badge-green'));
    assert.ok(rowOf(h, 'DSGN Co').includes('In design') && rowOf(h, 'DSGN Co').includes('badge-purple'));
    assert.ok(rowOf(h, 'PROD Co').includes('In production') && rowOf(h, 'PROD Co').includes('badge-blue'));
    assert.ok(rowOf(h, 'LEGP Co').includes('>pending<'));
    assert.ok(rowOf(h, 'BYFIN Co').includes('Confirmed by Shaira (Finance)'));
    assert.ok(!rowOf(h, 'CONF Co').includes('(Finance)'));
  });
  it('the header and KPI follow the new flow: "To confirm" counts awaiting + rejected + legacy pending', async () => {
    const h = await page(PRES);
    assert.ok(h.includes('Sales records the payment · the President confirms · Sales generates the sales order &amp; job order'));
    assert.ok(/To confirm<\/div><div class="kpi-value">4<\/div>/.test(h), 'awaiting + mineFin + rejected + legacyPending = 4');
    assert.ok(!h.includes('To Record'));
  });
  it('an empty list says where orders come from now', async () => {
    const h = await renderOrders(makeEnv(PRES, { seed: {} }));
    assert.ok(h.includes('They appear here when a payment is recorded on a quote.'));
  });
  it('the Job Order button prints through the existing print when the form engine is absent', async () => {
    const env = makeEnv(SALES, { seed: { sales_orders: { o1: rows.prod }, job_projects: { prj1: proj() } } });
    const printed = [];
    env.ctx.printJobOrder = (p, o) => printed.push([p, o]);
    const handlers = [];
    const c = { innerHTML: '', querySelectorAll: (sel) => (sel === '.so-jo-btn' ? [{ dataset: { id: 'o1' }, addEventListener: (t, fn) => handlers.push(fn) }] : []) };
    await env.ctx.window.renderSalesOrders(c);
    assert.equal(handlers.length, 1);
    await handlers[0]();
    assert.ok(env.ensured.includes('js/forms.js'), 'the form engine was tried first');
    assert.ok(env.ensured.includes('js/screens/production.js'), 'and the old print path took over');
    assert.equal(printed.length, 1);
    assert.equal(printed[0][0].id, 'prj1');
  });
  it('the Job Order button uses the form engine when it is there, and does not print twice', async () => {
    const opened = [];
    const env = makeEnv(SALES, { seed: { sales_orders: { o1: rows.prod }, job_projects: { prj1: proj() } }, forms: { open: async (k, a) => opened.push([k, a]) } });
    const printed = [];
    env.ctx.printJobOrder = () => printed.push(1);
    const handlers = [];
    await env.ctx.window.renderSalesOrders({ innerHTML: '', querySelectorAll: (sel) => (sel === '.so-jo-btn' ? [{ dataset: { id: 'o1' }, addEventListener: (t, fn) => handlers.push(fn) }] : []) });
    await handlers[0]();
    same(opened, [['job_order', { orderId: 'o1', projectId: 'prj1' }]]);
    assert.equal(printed.length, 0);
  });
  it('form buttons render ONLY when the form engine is already loaded (and never load it for a button)', async () => {
    const without = makeEnv(SALES, { seed: { sales_orders: { o1: rows.confirmed } } });
    assert.ok(!(await renderOrders(without)).includes('FORMBTN'));
    assert.ok(!without.ensured.includes('js/forms.js'), 'rendering the list must not load the form engine');
    const withF = makeEnv(SALES, { seed: { sales_orders: { o1: { ...rows.confirmed, releasedAt: { seconds: 5 } } } } });
    withF.ctx.Forms = { buttonHtml: (k) => `<i>FORMBTN-${k}</i>`, bind: () => {} };
    const h = await renderOrders(withF);
    assert.ok(h.includes('FORMBTN-payment_ack') && h.includes('FORMBTN-sales_order'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Record payment — create (§5.2)', () => {
  const seedQ = (over) => ({ bk_quotes: { q1: quote(over) } });
  async function open(who = SALES, opts = {}) {
    const env = makeEnv(who, { seed: seedQ(opts.quote), ...opts.env });
    const c = container();
    await env.ctx.openSalesOrderModal(dataset, env.ctx.currentUser, who.role, c);
    const p = env.lastPage();
    return { env, p, c };
  }
  const fill = (p, env, { paid = '65000', method = 'GCash', vat = 'inclusive', ref = 'GC-123', date = '2026-11-18', receipt = true } = {}) => {
    p.$('so-paid').value = paid; p.$('so-method').value = method; p.$('so-vat').value = vat; p.$('so-orref').value = ref; p.$('so-paydate').value = date;
    if (receipt) env.uploads['so-receipt-upload'].cb({ url: 'https://r.example/r.pdf', name: 'r.pdf' });
  };

  it('shows the contract as a read-only card taken from the quote, with no contract input and no DP% / date / priority / notes / project inputs', async () => {
    const { p } = await open();
    assert.equal(p.title.replace(/<i class="emo">[^<]*<\/i>/, '').trim(), 'Record payment');
    assert.ok(p.html.includes('₱100,000.00') && p.html.includes('Taken from the quote total. To change it, make a New Revision of the quote and have it approved.'));
    for (const gone of ['so-contract', 'so-dp-pct', 'so-target-date', 'so-priority', 'so-notes', 'so-project']) assert.ok(!(gone in p.els), gone);
    for (const kept of ['so-paid', 'so-paydate', 'so-method', 'so-vat', 'so-orref', 'so-receipt-upload', 'so-err', 'so-save']) assert.ok(kept in p.els, kept);
    assert.ok(p.html.includes('Record payment — send to President'));
    assert.ok(p.html.includes('Reference no. / BIR OR no. (if Finance issued one)'));
    assert.ok(p.html.includes('The President confirms this payment in the app. After that you generate the sales order and job order.'));
  });
  it('the live summary is the same arithmetic the confirmation uses (VAT split, balance, percent of contract)', async () => {
    const { p } = await open();
    p.$('so-paid').value = '65000'; await p.$('so-paid').fire('input');
    assert.equal(p.$('so-sum-rec').textContent, '₱65,000.00');
    assert.equal(p.$('so-sum-net').textContent, '₱58,035.71');
    assert.equal(p.$('so-sum-vat').textContent, '₱6,964.29');
    assert.equal(p.$('so-sum-bal').textContent, '₱35,000.00');
    assert.equal(p.$('so-sum-pct').textContent, 'This is 65% of the contract');
    p.$('so-paid').value = '100000'; p.$('so-vat').value = 'exclusive'; await p.$('so-vat').fire('change');
    assert.equal(p.$('so-sum-rec').textContent, '₱112,000.00');
  });
  it('records a payment: a pending flow-2 order and a flow-2 project — and NOTHING reaches the ledger', async () => {
    const { env, p } = await open(SALES);
    fill(p, env);
    await p.$('so-save').click();
    assert.equal(p.$('so-err').textContent, '', 'no error shown');
    // the project
    assert.equal(env.jobProjectArgs.length, 1);
    same([env.jobProjectArgs[0].flowVersion, env.jobProjectArgs[0].total, env.jobProjectArgs[0].dpPercent, env.jobProjectArgs[0].targetDate, env.jobProjectArgs[0].priority, env.jobProjectArgs[0].notes], [2, 100000, 50, '', '', '']);
    same(env.jobProjectArgs[0].items, [{ name: 'Table', qty: 2 }]);
    // the order
    const orders = [...env.db.store.sales_orders.entries()];
    assert.equal(orders.length, 1);
    const [oid, o] = orders[0];
    assert.equal(o.status, 'pending'); assert.equal(o.flowVersion, 2);
    assert.equal(o.contractAmount, 100000, 'the contract is the quote total, read from the quote — never from a field');
    assert.equal(o.paymentReceived, 65000); assert.equal(o.paymentMethod, 'GCash'); assert.equal(o.vatTreatment, 'inclusive');
    assert.equal(o.orRef, 'GC-123'); assert.equal(o.paymentDate, '2026-11-18');
    assert.equal(o.receiptUrl, 'https://r.example/r.pdf'); assert.equal(o.receiptName, 'r.pdf');
    assert.equal(o.rootQuoteId, 'q1'); assert.equal(o.project, 'Acme Foods — BK-260101-001');
    assert.equal(o.createdBy, 'u-sales'); assert.equal(o.createdByName, 'Uriel');
    assert.equal(o.paymentConfirm.decision, null); assert.equal(o.paymentConfirm.resubmits, 0); assert.equal(o.paymentConfirm.requestedBy, 'u-sales');
    same([o.notes, o.targetDate, o.priority], ['', '', '']);
    assert.ok(o.trackingToken, 'the client tracking token is stamped');
    // no ledger, no 'recorded', no autoRecorded
    assert.equal(env.db.store.ledger, undefined, 'the ledger was not written');
    assert.ok(!('recordedAmount' in o) && !('autoRecorded' in o) && o.status !== 'recorded');
    // the quote back-link, the project link
    const q = env.db.store.bk_quotes.get('q1');
    same([q.salesOrderId, q.status], [oid, 'won']);
    const pr = env.db.store.job_projects.get(env.db.store.job_projects.keys().next().value);
    assert.equal(pr.salesOrderId, oid);
    assert.ok(!pr.documents.some((d) => d.type === 'Sales Order'), 'the Sales Order document row moved to Generate');
    // the tracker shows nothing paid yet
    const tr = env.db.store.order_tracking.get('TRK12345');
    same([tr.paid, tr.balance, tr.contractAmount], [0, 100000, 100000]);
  });
  it('tells the President (N1) and Finance (N1F, no owner fallback); the old "New Sales Order" and "Quote won" pings are gone', async () => {
    const { env, p } = await open(SALES);
    fill(p, env);
    await p.$('so-save').click();
    const oid = [...env.db.store.sales_orders.keys()][0];
    const n1 = env.notifs.find((n) => n.kind === 'owner');
    same([n1.title, n1.type, n1.link, n1.dedupKey], ['💵 Payment to confirm', 'payment_confirm', 'approvals', `payconf-${oid}-0`]);
    assert.equal(n1.body, 'Uriel: Acme Foods — ₱65,000.00 by GCash (BK-260101-001). Tap to confirm.');
    const n1f = env.notifs.find((n) => n.kind === 'dept');
    same([n1f.dept, n1f.title, n1f.type, n1f.link, n1f.dedupKey, n1f.opts], ['Finance', '💵 Payment recorded — President to confirm', 'payment_confirm', 'sales-orders', `payfyi-${oid}-0`, null]);
    assert.ok(n1f.body.endsWith('No action needed unless the President cannot be reached.'));
    assert.equal(env.notifs.length, 2);
    assert.ok(!env.notifs.some((n) => /New Sales Order|Quote won/.test(n.title)));
    assert.ok(env.toastMsgs().includes('Payment recorded — waiting for confirmation'));
    assert.equal(env.closes, 1, 'a non-President just closes the modal');
    assert.equal(env.pages.length, 1, 'and no confirm sheet is opened for them');
    assert.equal(env.rerenders.length, 1, 'the quote list re-renders');
  });
  it('refuses an amount over the contract (the VAT-exclusive foot-gun), no amount, and a missing receipt — and writes nothing', async () => {
    for (const [fillOpts, msg] of [
      [{ paid: '100000', vat: 'exclusive' }, 'The payment is more than the contract amount.'],
      [{ paid: '0' }, 'Enter the amount the client paid.'],
      [{ paid: '' }, 'Enter the amount the client paid.'],
      [{ receipt: false }, 'Attach the receipt or proof of payment.'],
    ]) {
      const { env, p } = await open(SALES);
      fill(p, env, fillOpts);
      await p.$('so-save').click();
      assert.equal(p.$('so-err').textContent, msg);
      assert.ok(!p.$('so-err').classList.contains('hidden'));
      assert.equal(env.jobProjectArgs.length, 0); assert.equal(env.db.store.sales_orders, undefined); assert.equal(env.notifs.length, 0);
    }
  });
  it('a quote with no total cannot have a payment recorded against it', async () => {
    const { env, p } = await open(SALES, { quote: { total: 0 } });
    fill(p, env);
    await p.$('so-save').click();
    assert.equal(p.$('so-err').textContent, 'This quote has no total, so a payment cannot be recorded against it.');
    assert.equal(env.jobProjectArgs.length, 0);
  });
  it('waits for an upload still in flight', async () => {
    const { env, p } = await open(SALES);
    fill(p, env); p.$('so-receipt-upload').dataset.busy = '1';
    await p.$('so-save').click();
    assert.ok(env.toastMsgs().includes('Wait for the upload to finish'));
    assert.equal(env.jobProjectArgs.length, 0);
  });
  it('the contract comes from the quote document even if the card\'s total is stale (no way to type a different contract)', async () => {
    const env = makeEnv(SALES, { seed: seedQ({ total: 80000 }) });
    await env.ctx.openSalesOrderModal({ ...dataset, total: '999999' }, env.ctx.currentUser, 'employee', container());
    const p = env.lastPage(); fill(p, env, { paid: '40000' });
    await p.$('so-save').click();
    assert.equal([...env.db.store.sales_orders.values()][0].contractAmount, 80000);
  });
  it('a failed quote read falls back to the card total (never blocks the modal)', async () => {
    const env = makeEnv(SALES, { seed: {} });   // no quote doc at all
    await env.ctx.openSalesOrderModal(dataset, env.ctx.currentUser, 'employee', container());
    assert.ok(env.lastPage().html.includes('₱100,000.00'));
  });
  it('(A1) one order per quote chain: refuses when an earlier revision already has an order, writing nothing', async () => {
    const env = makeEnv(SALES, { seed: { bk_quotes: { q1: quote({ rootQuoteId: 'root0' }), root0: quote({ rootQuoteId: 'root0', salesOrderId: 'so-old', quoteNumber: 'BK-260101-001' }) } } });
    await env.ctx.openSalesOrderModal(dataset, env.ctx.currentUser, 'employee', container());
    const p = env.lastPage(); fill(p, env);
    await p.$('so-save').click();
    assert.equal(p.$('so-err').textContent, 'An earlier revision of this quote already has a sales order. A price change after payment is handled on that order, not by recording a new one. Ask the President.');
    assert.equal(env.jobProjectArgs.length, 0); assert.equal(env.db.store.sales_orders, undefined);
  });
  it('(A1) the chain query is scoped to the caller\'s own quotes for a non-admin (bk_quotes reads are creator-or-admin), unscoped for an admin', async () => {
    const mk = async (who) => { const env = makeEnv(who, { seed: seedQ() }); await env.ctx.openSalesOrderModal(dataset, env.ctx.currentUser, who.role, container()); const p = env.lastPage(); fill(p, env); await p.$('so-save').click(); return env.db.log.filter((l) => l.op === 'query' && l.path === 'bk_quotes'); };
    const q1 = await mk(SALES);
    same(q1[0].filters, [['rootQuoteId', 'q1'], ['createdBy', 'u-sales']]);
    const q2 = await mk(PRES);
    same(q2[0].filters, [['rootQuoteId', 'q1']]);
  });
  it('(A1) a chain check that cannot be read fails closed: "Could not check earlier revisions — try again." and nothing is written', async () => {
    const env = makeEnv(SALES, { seed: seedQ() });
    const realCollection = env.db.collection.bind(env.db);
    env.db.collection = (c) => { const x = realCollection(c); if (c !== 'bk_quotes') return x; return { ...x, where: () => ({ where: () => ({ get: async () => { throw new Error('permission-denied'); } }), get: async () => { throw new Error('permission-denied'); } }) }; };
    await env.ctx.openSalesOrderModal(dataset, env.ctx.currentUser, 'employee', container());
    const p = env.lastPage(); fill(p, env);
    await p.$('so-save').click();
    assert.equal(p.$('so-err').textContent, 'Could not check earlier revisions — try again.');
    assert.equal(env.jobProjectArgs.length, 0);
  });
  it('a quote already converted is surfaced with the old "open the existing project" help (createJobProject\'s guard)', async () => {
    const env = makeEnv(SALES, { seed: seedQ() });
    env.ctx.createJobProject = async () => { throw Object.assign(new Error('This quote has already been converted to a Sales Order — refresh the list.'), { code: 'already-converted', existingProjectId: 'pX' }); };
    await env.ctx.openSalesOrderModal(dataset, env.ctx.currentUser, 'employee', container());
    const p = env.lastPage(); fill(p, env);
    await p.$('so-save').click();
    assert.ok(p.$('so-err').innerHTML.includes('already been converted') && p.$('so-err').innerHTML.includes('so-open-existing-btn'));
    assert.equal(env.db.store.sales_orders, undefined);
  });
  it('when the PRESIDENT records it, his confirm sheet REPLACES the modal in place (never closeModal()-then-open)', async () => {
    const { env, p } = await open(PRES);
    fill(p, env);
    await p.$('so-save').click();
    assert.equal(env.closes, 0, 'no closeModal: its async history.back would pop the sheet that was just opened');
    assert.equal(env.pages.length, 2);
    const sheet = env.pages[1];
    assert.equal(sheet.title, 'Confirm payment — Acme Foods');
    same(sheet.opts, { replace: true });
    assert.ok('pc-confirm' in sheet.els);
  });
  it('the Brilliance Steel list re-renders for a BS quote (and a bs_quotes chain query is unscoped: any staff may read it)', async () => {
    const env = makeEnv(SALES, { seed: { bs_quotes: { q1: quote({ company: 'BS' }) } } });
    await env.ctx.openSalesOrderModal({ ...dataset, co: 'BS' }, env.ctx.currentUser, 'employee', container());
    const p = env.lastPage(); fill(p, env);
    await p.$('so-save').click();
    same(env.rerenders, [['bs']]);
    const q = env.db.log.filter((l) => l.op === 'query' && l.path === 'bs_quotes');
    same(q[0].filters, [['rootQuoteId', 'q1']]);
    assert.equal(env.db.store.bs_quotes.get('q1').status, 'won');
  });
});

describe('Record payment — edit / fix & resubmit (§5.2)', () => {
  const editEnv = (over = {}, who = SALES) => makeEnv(who, { seed: { sales_orders: { o1: pend(over) }, job_projects: { prj1: proj() } } });
  async function open(env, o) { await env.ctx.openSalesOrderModal({ id: 'q1', qno: 'BK-260101-001', client: 'Acme Foods', clientId: '', total: 100000, co: 'BK' }, env.ctx.currentUser, env.who.role, container(), { id: 'o1', ...o }); return env.lastPage(); }
  it('opens prefilled from the order, titled "Edit payment", with the contract fixed and the existing receipt shown', async () => {
    const env = editEnv(); const o = env.db.store.sales_orders.get('o1');
    const p = await open(env, o);
    assert.equal(p.title.replace(/<i class="emo">[^<]*<\/i>/, '').trim(), 'Edit payment');
    assert.equal(p.$('so-paid').value, '65000'); assert.equal(p.$('so-method').value, 'GCash'); assert.equal(p.$('so-vat').value, 'inclusive'); assert.equal(p.$('so-orref').value, 'OR-77'); assert.equal(p.$('so-paydate').value, '2026-11-18');
    assert.ok(p.html.includes('Save and resubmit') && p.html.includes('Current receipt:'));
  });
  it('resubmits a rejected payment: status back to pending, a fresh request with resubmits+1 and the reason being answered — and writes NOTHING else', async () => {
    const env = editEnv({ status: 'payment_rejected', paymentConfirm: { decision: 'rejected', reason: 'wrong amount', resubmits: 0, decidedBy: 'u-pres', decidedByName: 'Neil Barro', decidedByRole: 'president', onBehalf: false } });
    const p = await open(env, env.db.store.sales_orders.get('o1'));
    p.$('so-paid').value = '60000'; p.$('so-orref').value = 'OR-88';
    await p.$('so-save').click();
    const o = env.db.store.sales_orders.get('o1');
    same([o.status, o.paymentReceived, o.orRef], ['pending', 60000, 'OR-88']);
    same(o.paymentConfirm, { requestedAt: o.paymentConfirm.requestedAt, requestedBy: 'u-sales', requestedByName: 'Uriel', decision: null, resubmits: 1, prevReason: 'wrong amount' });
    assert.equal(o.receiptUrl, 'https://r.example/1.pdf', 'the existing receipt is kept when none is replaced');
    assert.equal(o.contractAmount, 100000, 'the contract is never rewritten');
    const writes = env.db.log.filter((l) => l.op !== 'query');
    same(writes.map((w) => w.path), ['sales_orders/o1'], 'no project, quote or tracking write');
    const allowed = salesAllowedKeys();
    for (const k of Object.keys(writes[0].patch)) assert.ok(allowed.has(k), `the rules would deny Sales writing ${k}`);
    assert.ok(env.toastMsgs().includes('Payment updated — sent to the President again'));
    const n4 = env.notifs.find((n) => n.kind === 'owner');
    same([n4.title, n4.type, n4.link, n4.dedupKey], ['💵 Payment corrected — please confirm', 'payment_confirm', 'approvals', 'payconf-o1-1']);
    const n1f = env.notifs.find((n) => n.kind === 'dept');
    assert.equal(n1f.dedupKey, 'payfyi-o1-1');
    assert.equal(env.rerenders.length, 0, 'the quote list is not touched; the Sales Orders page re-renders');
  });
  it('a pending payment can be edited too (Edit payment), counting as a resubmit', async () => {
    const env = editEnv();
    const p = await open(env, env.db.store.sales_orders.get('o1'));
    p.$('so-paid').value = '50000';
    await p.$('so-save').click();
    const o = env.db.store.sales_orders.get('o1');
    same([o.status, o.paymentReceived, o.paymentConfirm.resubmits, o.paymentConfirm.prevReason], ['pending', 50000, 1, '']);
  });
  it('refuses to touch an order that was confirmed in the meantime (fresh read first)', async () => {
    const env = editEnv();
    const p = await open(env, env.db.store.sales_orders.get('o1'));
    await env.db.collection('sales_orders').doc('o1').update({ status: 'recorded' });   // the President confirmed while the modal was open
    env.db.log.length = 0;
    p.$('so-paid').value = '1000';
    await p.$('so-save').click();
    assert.ok(env.toastMsgs().includes('This payment was already confirmed.'));
    assert.equal(env.db.log.filter((l) => l.op !== 'query').length, 0, 'nothing written');
    assert.equal(env.db.store.sales_orders.get('o1').paymentReceived, 65000);
  });
  it('validates exactly like a new payment (over the contract is refused)', async () => {
    const env = editEnv();
    const p = await open(env, env.db.store.sales_orders.get('o1'));
    p.$('so-paid').value = '100000'; p.$('so-vat').value = 'exclusive';
    await p.$('so-save').click();
    assert.equal(p.$('so-err').textContent, 'The payment is more than the contract amount.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('The confirmation sheet (§5.4, §14.2.3): one tap, one post', () => {
  const seed = (o = {}, p = {}) => ({ sales_orders: { o1: pend(o) }, job_projects: { prj1: proj(p) } });
  const orderOf = (env) => ({ id: 'o1', ...env.db.store.sales_orders.get('o1') });
  async function sheet(who, { o = {}, p = {}, banks = [], ...rest } = {}) {
    const env = makeEnv(who, { seed: seed(o, p), banks, ...rest });
    const ord = orderOf(env);
    let done = 0;
    await env.ctx.window.openPaymentConfirmSheet(ord, () => { done++; });
    return { env, s: env.lastPage(), ord, done: () => done };
  }
  it('shows the amount, the terms, the VAT split, who recorded it, the receipt link — and no bank box when there are no accounts', async () => {
    const { s } = await sheet(PRES);
    assert.equal(s.title, 'Confirm payment — Acme Foods');
    for (const t of ['₱65,000.00', 'GCash · paid 2026-11-18 · OR OR-77', 'Contract ₱100,000.00 · this payment is 65% · balance after ₱35,000.00', 'Net ₱58,035.71 · VAT ₱6,964.29 (inclusive)', 'Recorded by Uriel', 'View receipt']) assert.ok(s.html.includes(t), t);
    assert.ok(!('pc-bank' in s.els));
    assert.ok(!s.html.includes('The President normally confirms payments'), 'no stand-in banner for the President');
    assert.ok(s.html.includes('min-height:44px'));
  });
  it('a resubmitted payment shows the earlier reason', async () => {
    const { s } = await sheet(PRES, { o: { paymentConfirm: { requestedAt: '2026-11-18T01:00:00.000Z', decision: null, resubmits: 1, prevReason: 'wrong amount' } } });
    assert.ok(s.html.includes('Resubmitted — earlier reason: wrong amount'));
  });
  it('the President confirms: ONE ledger row SO-<order id>, the project\'s collected / AR in the same call, the order recorded, the tracker synced', async () => {
    const { env, s, done } = await sheet(PRES);
    await s.$('pc-confirm').click();
    same([...env.db.store.ledger.keys()], ['SO-o1']);
    const row = env.db.store.ledger.get('SO-o1');
    same([row.amount, row.type, row.source, row.date, row.projectId, row.confirmedBy, row.confirmedByRole], [65000, 'credit', 'Sales', '2026-11-19', 'prj1', 'Neil Barro', 'president']);
    const pr = env.db.store.job_projects.get('prj1');
    same([pr.amountCollected, pr.arBalance], [65000, 35000]);
    assert.equal(pr.stage, 'won', 'confirming a payment never changes the job\'s stage');
    assert.equal(pr.payments.length, 1); assert.equal(pr.payments[0].type, 'Sales Order Payment'); assert.equal(pr.payments[0].confirmedByRole, 'president');
    assert.ok(pr.documents.some((d) => d.type === 'Payment Acknowledgement'));
    assert.ok(!JSON.stringify(pr).includes('Official Receipt'));
    assert.ok(pr.timeline.some((t) => t.event === 'Payment ₱65000.00 confirmed by the President'));
    const o = env.db.store.sales_orders.get('o1');
    same([o.status, o.recordedAmount, o.recordedBy], ['recorded', 65000, 'Neil Barro']);
    same([o.paymentConfirm.decision, o.paymentConfirm.decidedBy, o.paymentConfirm.decidedByRole, o.paymentConfirm.onBehalf], ['confirmed', 'u-pres', 'president', false]);
    same(env.tracking, [{ token: 'tok1', patch: { paid: 65000, balance: 35000 } }]);
    assert.ok(o.recordedAt, 'a server timestamp is stamped');
    assert.equal(done(), 1); assert.equal(env.closes, 1);
    assert.ok(env.toastMsgs().includes('Payment confirmed and posted to the ledger'));
    for (const k of ['ledger', 'job_projects', 'sales_orders', 'approvals-pending:sales_orders-pending']) assert.ok(env.invalidated.includes(k), k);
    assert.ok(env.audits.some((a) => a[0] === 'create' && a[1] === 'ledger' && a[2] === 'SO-o1' && a[3].confirmedByRole === 'president' && a[3].amount === 65000));
  });
  it('tells Sales (N2) and Finance (N3) — not the President himself; the wording names who confirmed', async () => {
    const { env, s } = await sheet(PRES);
    await s.$('pc-confirm').click();
    const n2 = env.notifs.find((n) => n.kind === 'send');
    same([n2.to, n2.title, n2.type, n2.link, n2.dedupKey], ['u-sales', '✅ Payment confirmed', 'payment_confirmed', 'sales-orders', 'payok-o1']);
    assert.equal(n2.body, 'Acme Foods — ₱65,000.00 confirmed by the President. Generate the sales order and job order.');
    const n3 = env.notifs.find((n) => n.kind === 'dept');
    same([n3.dept, n3.title, n3.dedupKey, n3.opts], ['Finance', '💵 Payment confirmed', 'payfin-o1', null]);
    assert.equal(n3.body, 'Acme Foods (JP-2611-001) — ₱65,000.00 confirmed by the President and posted to the ledger. No action needed.');
    assert.ok(!env.notifs.some((n) => n.kind === 'owner'), 'no extra notification to the President when he confirms himself');
  });
  it('asks the form engine to number the Payment Acknowledgement, and a missing engine never fails the confirmation', async () => {
    const numbered = [];
    const { env, s } = await sheet(PRES, { forms: { assignNumbers: async (k, a) => numbered.push([k, a]) } });
    await s.$('pc-confirm').click();
    same(numbered, [[['payment_ack'], { orderId: 'o1' }]]);
    const none = await sheet(PRES);
    await none.s.$('pc-confirm').click();
    assert.ok(none.env.ensured.includes('js/forms.js'));
    assert.equal(none.env.db.store.sales_orders.get('o1').status, 'recorded', 'the engine is absent and the payment is confirmed all the same');
    assert.ok(none.env.toastMsgs().includes('Payment confirmed and posted to the ledger'));
  });
  it('a form engine that throws is swallowed too', async () => {
    const { env, s } = await sheet(PRES, { forms: { assignNumbers: async () => { throw new Error('boom'); } } });
    await s.$('pc-confirm').click();
    assert.equal(env.db.store.sales_orders.get('o1').status, 'recorded');
  });
  it('a second tap (a stale sheet) posts nothing more: "already confirmed"', async () => {
    const { env, s, ord } = await sheet(PRES);
    await s.$('pc-confirm').click();
    const rows = env.db.log.filter((l) => l.op !== 'query' && l.path.startsWith('ledger/')).length;
    await s.$('pc-confirm').click();                 // the same stale sheet
    assert.equal(env.db.log.filter((l) => l.op !== 'query' && l.path.startsWith('ledger/')).length, rows);
    assert.equal(env.db.store.job_projects.get('prj1').amountCollected, 65000, 'the project moved once');
    assert.ok(env.toastMsgs().includes('This payment was already confirmed.'));
    assert.equal(env.toasts.filter((t) => t.msg === 'This payment was already confirmed.')[0].type, 'error');
  });
  it('a retry after the order update failed lands in the repair branch: no second project increment', async () => {
    const { env, s } = await sheet(PRES);
    const real = env.db.collection.bind(env.db);
    let failOnce = true;
    env.db.collection = (c) => { const x = real(c); if (c !== 'sales_orders') return x; return { ...x, doc: (id) => { const d = x.doc(id); return { ...d, update: async (patch) => { if (failOnce && patch.status === 'recorded') { failOnce = false; throw new Error('network'); } return d.update(patch); } }; } }; };
    await s.$('pc-confirm').click();
    assert.ok(s.$('pc-err').textContent.startsWith('Failed: network'), s.$('pc-err').textContent);
    assert.equal(env.db.store.job_projects.get('prj1').amountCollected, 65000, 'the post went through');
    assert.equal(env.db.store.sales_orders.get('o1').status, 'pending');
    await s.$('pc-confirm').click();                 // retry
    assert.equal(env.db.store.sales_orders.get('o1').status, 'recorded');
    assert.equal(env.db.store.job_projects.get('prj1').amountCollected, 65000, 'still once');
    assert.equal(env.db.store.ledger.size, 1);
    assert.ok(env.toastMsgs().includes('Already in the ledger — order marked confirmed'));
    assert.equal(env.audits.filter((a) => a[1] === 'ledger').length, 0, 'no ledger audit row for the repair (and none for the failed first attempt: the throw came before result handling)');
  });
  it('a row that already exists in the ledger (a legacy post) is repaired, never re-posted', async () => {
    const { env, s } = await sheet(PRES);
    await env.db.collection('ledger').doc('SO-o1').set({ refNumber: 'SO-o1', amount: 70000 });
    await s.$('pc-confirm').click();
    const o = env.db.store.sales_orders.get('o1');
    same([o.status, o.recordedAmount], ['recorded', 70000]);
    assert.equal(env.db.store.job_projects.get('prj1').amountCollected, 0, 'the project is left alone');
    assert.equal(env.tracking.length, 0);
  });
  it('with bank accounts on file the confirmer must choose one, and the choice is remembered', async () => {
    const banks = [{ id: 'b1', nickname: 'BDO Main' }, { id: 'b2', nickname: 'GCash' }];
    const { env, s } = await sheet(PRES, { banks });
    assert.ok('pc-bank' in s.els);
    await s.$('pc-confirm').click();
    assert.equal(s.$('pc-err').textContent, 'Select the company account that received this payment.');
    assert.equal(env.db.store.ledger, undefined);
    s.$('pc-bank').value = 'b2';
    await s.$('pc-confirm').click();
    const row = env.db.store.ledger.get('SO-o1');
    same([row.bankAccountId, row.bankFlow], ['b2', 'in']);
    const o = env.db.store.sales_orders.get('o1');
    same([o.bankAccountId, o.bankAccountName], ['b2', 'Bank b2']);
    assert.equal(env.ctx.localStorage.getItem('bi.payConfirm.bank'), 'b2');
    // the next sheet pre-selects it
    const again = makeEnv(PRES, { seed: seed(), banks });
    again.ctx.localStorage.setItem('bi.payConfirm.bank', 'b2');
    await again.ctx.window.openPaymentConfirmSheet(orderOf(again), () => {});
    assert.equal(again.lastPage().$('pc-bank').value, 'b2');
  });
  it('Finance as the President\'s stand-in (owner ruling SF4): a small inline note, ONE tap with no extra dialog, recorded as hers, and he is told (N9)', async () => {
    const { env, s } = await sheet(FIN);
    assert.ok(s.html.includes('The President normally confirms payments. Confirm only if he cannot be reached. He will be told that you confirmed it.'));
    assert.ok(!s.html.includes('alert-banner'), 'a small note, not a warning banner');
    await s.$('pc-confirm').click();
    assert.equal(env.dialogs.length, 0, 'no "in the President\'s place?" dialog in front of the confirm');
    assert.ok(env.toastMsgs().includes('Payment confirmed and posted to the ledger'), 'one tap confirmed it');
    const o = env.db.store.sales_orders.get('o1');
    same([o.status, o.paymentConfirm.decidedBy, o.paymentConfirm.decidedByName, o.paymentConfirm.decidedByRole, o.paymentConfirm.onBehalf], ['recorded', 'u-fin', 'Shaira', 'finance', true]);
    assert.equal(env.db.store.ledger.get('SO-o1').confirmedByRole, 'finance');
    assert.ok(env.db.store.job_projects.get('prj1').timeline.some((t) => t.event.includes('Finance (Shaira)')));
    const n9 = env.notifs.find((n) => n.kind === 'owner');
    same([n9.title, n9.type, n9.link, n9.dedupKey], ['✅ Payment confirmed by Shaira (Finance)', 'payment_confirmed', 'sales-orders', 'payown-o1']);
    assert.equal(n9.body, 'Acme Foods (BK-260101-001) — ₱65,000.00 by GCash, recorded by Uriel. Confirmed in your place and posted to the ledger.');
    assert.ok(env.notifs.find((n) => n.kind === 'send').body.includes('confirmed by Finance (Shaira)'));
  });
  it('the President\'s confirm is one tap too, with no dialog and no note', async () => {
    const { env, s } = await sheet(PRES);
    assert.ok(!s.html.includes('The President normally confirms payments'));
    await s.$('pc-confirm').click();
    assert.equal(env.dialogs.length, 0);
    assert.equal(env.db.store.sales_orders.get('o1').status, 'recorded');
  });
  it('Finance cannot confirm a payment she recorded herself, even through a stale sheet', async () => {
    const { env, s } = await sheet(FIN, { o: { createdBy: 'u-fin', createdByName: 'Shaira' } });
    await s.$('pc-confirm').click();
    assert.ok(env.toastMsgs().includes('You cannot confirm this payment.'));
    assert.equal(env.dialogs.length, 0);
    assert.equal(env.db.store.ledger, undefined); assert.equal(env.db.store.sales_orders.get('o1').status, 'pending');
  });
  it('Sales cannot confirm through a stale sheet either', async () => {
    const { env, s } = await sheet(SALES);
    await s.$('pc-confirm').click();
    assert.ok(env.toastMsgs().includes('You cannot confirm this payment.'));
    assert.equal(env.db.store.ledger, undefined);
  });
  it('a payment sent back meanwhile cannot be confirmed from a stale sheet; an invalid one shows why', async () => {
    const a = await sheet(PRES);
    await a.env.db.collection('sales_orders').doc('o1').update({ status: 'payment_rejected' });
    await a.s.$('pc-confirm').click();
    assert.ok(a.env.toastMsgs().includes('This payment was sent back to Sales. It must be resubmitted first.'));
    assert.equal(a.env.db.store.ledger, undefined);
    const b = await sheet(PRES, { o: { paymentReceived: 0 } });
    await b.s.$('pc-confirm').click();
    assert.equal(b.s.$('pc-err').textContent, 'Enter the amount the client paid.');
    const c = await sheet(PRES, { o: { flowVersion: undefined } });
    await c.s.$('pc-confirm').click();
    assert.ok(c.env.toastMsgs().includes('This order cannot be confirmed here.'));
  });
  it('a ledger failure (a closed period) is shown on the sheet and nothing else moves', async () => {
    const { env, s } = await sheet(PRES);
    env.ctx.Ledger.post = async () => { throw new Error('The period is closed'); };
    await s.$('pc-confirm').click();
    assert.equal(s.$('pc-err').textContent, 'Failed: The period is closed');
    assert.equal(env.db.store.sales_orders.get('o1').status, 'pending'); assert.equal(env.closes, 0);
  });
  it('the Reject button on the sheet sends it back and closes the sheet only when it was rejected', async () => {
    const a = await sheet(PRES, { promptAnswer: null });
    await a.s.$('pc-reject').click();
    assert.equal(a.env.closes, 0, 'cancelled: the sheet stays');
    const b = await sheet(PRES);
    await b.s.$('pc-reject').click();
    assert.equal(b.env.closes, 1);
    assert.equal(b.env.db.store.sales_orders.get('o1').status, 'payment_rejected');
  });
});

describe('Rejecting a payment (§5.4, §14.2.3)', () => {
  const seed = (o = {}) => ({ sales_orders: { o1: pend(o) }, job_projects: { prj1: proj() } });
  const go = async (who, { o = {}, promptAnswer = 'amount does not match the receipt' } = {}) => {
    const env = makeEnv(who, { seed: seed(o), promptAnswer });
    let done = 0;
    const res = await env.ctx.window.rejectOrderPayment({ id: 'o1', ...env.db.store.sales_orders.get('o1') }, () => { done++; });
    return { env, res, done: () => done };
  };
  it('the President sends it back with a reason: status, the stamp, a notice to Sales — and NOTHING in the ledger, project, quote or tracker', async () => {
    const { env, res, done } = await go(PRES);
    assert.equal(res, true);
    const o = env.db.store.sales_orders.get('o1');
    assert.equal(o.status, 'payment_rejected');
    same([o.paymentConfirm.decision, o.paymentConfirm.reason, o.paymentConfirm.decidedBy, o.paymentConfirm.decidedByName, o.paymentConfirm.decidedByRole, o.paymentConfirm.onBehalf], ['rejected', 'amount does not match the receipt', 'u-pres', 'Neil Barro', 'president', false]);
    assert.equal(o.paymentConfirm.requestedBy, 'u-sales', 'the request fields are kept');
    assert.equal(env.db.store.ledger, undefined);
    same(env.db.log.filter((l) => l.op !== 'query').map((l) => l.path), ['sales_orders/o1']);
    assert.equal(env.tracking.length, 0);
    const n5 = env.notifs.find((n) => n.kind === 'send');
    same([n5.to, n5.title, n5.type, n5.link, n5.dedupKey], ['u-sales', '↩️ Payment sent back', 'payment_rejected', 'sales-orders', 'payrej-o1-0']);
    assert.equal(n5.body, 'Acme Foods (BK-260101-001), sent back by the President: amount does not match the receipt');
    assert.ok(!env.notifs.some((n) => n.kind === 'owner'), 'the President is not told about his own rejection');
    assert.ok(env.toastMsgs().includes('Sent back to Sales'));
    assert.equal(done(), 1);
    assert.ok(env.invalidated.includes('approvals-pending:sales_orders-pending'));
    same(env.prompts[0], { title: 'Reject payment', message: 'Tell Sales what to fix.', placeholder: 'e.g. amount does not match the receipt', required: true, multiline: true, confirmLabel: 'Reject' });
    assert.ok(env.audits.some((a) => a[0] === 'update' && a[1] === 'sales_order' && a[2] === 'o1' && a[3].paymentRejected));
  });
  it('Finance rejecting as the stand-in is stamped as Finance, tells Sales who sent it back, and tells the President (N10)', async () => {
    const { env, res } = await go(FIN);
    assert.equal(res, true);
    const pc = env.db.store.sales_orders.get('o1').paymentConfirm;
    same([pc.decidedBy, pc.decidedByRole, pc.onBehalf], ['u-fin', 'finance', true]);
    assert.ok(env.notifs.find((n) => n.kind === 'send').body.includes('sent back by Finance (Shaira)'));
    const n10 = env.notifs.find((n) => n.kind === 'owner');
    same([n10.title, n10.type, n10.link, n10.dedupKey], ['↩️ Payment sent back by Shaira (Finance)', 'payment_rejected', 'sales-orders', 'payrejown-o1-0']);
    assert.equal(n10.body, 'Acme Foods (BK-260101-001) — ₱65,000.00: amount does not match the receipt');
  });
  it('the dedup key counts resubmits, so a second rejection of a resubmitted payment is a new notice', async () => {
    const { env } = await go(PRES, { o: { paymentConfirm: { decision: null, resubmits: 2, requestedBy: 'u-sales' } } });
    assert.equal(env.notifs.find((n) => n.kind === 'send').dedupKey, 'payrej-o1-2');
  });
  it('cancelling the reason prompt writes nothing', async () => {
    const { env, res } = await go(PRES, { promptAnswer: null });
    assert.equal(res, false);
    assert.equal(env.db.log.filter((l) => l.op !== 'query').length, 0);
  });
  it('an order confirmed meanwhile cannot be rejected, and one already sent back is not rejected twice', async () => {
    const a = await go(PRES, { o: { status: 'recorded' } });
    assert.equal(a.res, false);
    assert.ok(a.env.toastMsgs().includes('Already confirmed — it cannot be rejected.'));
    assert.equal(a.env.db.store.sales_orders.get('o1').status, 'recorded');
    const b = await go(PRES, { o: { status: 'payment_rejected' } });
    assert.equal(b.res, false);
    assert.ok(b.env.toastMsgs().includes('This payment is not waiting for confirmation.'));
  });
  it('Sales, a manager outside Finance and Finance-who-recorded-it cannot reject (nothing is even asked)', async () => {
    for (const [who, o] of [[SALES, {}], [MGR, {}], [FIN, { createdBy: 'u-fin' }]]) {
      const { env, res } = await go(who, { o });
      assert.equal(res, false);
      assert.ok(env.toastMsgs().includes('You cannot reject this payment.'));
      assert.equal(env.prompts.length, 0);
      assert.equal(env.db.store.sales_orders.get('o1').status, 'pending');
    }
  });
});

describe('"Payments to confirm" (§5.4, §14.2.3)', () => {
  const seed = () => ({ sales_orders: {
    a: pend({ clientName: 'Alpha', createdAt: { seconds: 20 } }),
    b: pend({ clientName: 'Bravo', createdAt: { seconds: 30 } }),
    fin: pend({ clientName: 'FinOwn', createdBy: 'u-fin', createdByName: 'Shaira', createdAt: { seconds: 40 } }),
    done: pend({ clientName: 'Done', status: 'recorded' }),
    legacy: pend({ clientName: 'Legacy', flowVersion: undefined }),
    back: pend({ clientName: 'Back', status: 'payment_rejected' }),
  } });
  const host = () => ({ innerHTML: 'x', _h: [], querySelectorAll(sel) { return this._els || []; } });
  it('pendingPaymentConfirmations lists only awaiting flow-2 orders, newest first', async () => {
    const env = makeEnv(PRES, { seed: seed() });
    const list = await env.ctx.window.pendingPaymentConfirmations();
    same(list.map((o) => o.clientName), ['FinOwn', 'Bravo', 'Alpha']);
  });
  it('it never throws: a failed read is an empty list', async () => {
    const env = makeEnv(PRES, { seed: seed() });
    env.ctx.dbCachedGet = async () => { throw new Error('denied'); };
    same(await env.ctx.window.pendingPaymentConfirmations(), []);
  });
  it('the President sees every one, with Confirm / Reject on each', async () => {
    const env = makeEnv(PRES, { seed: seed() }); const h = host();
    await env.ctx.window.renderPaymentConfirmList(h, {});
    assert.ok(h.innerHTML.includes('Payments to confirm') && !h.innerHTML.includes('stand-in'));
    assert.ok(h.innerHTML.includes('<span class="badge badge-orange">3</span>'));
    assert.equal((h.innerHTML.match(/pcl-open/g) || []).length, 3);
    assert.equal((h.innerHTML.match(/pcl-reject/g) || []).length, 3);
    assert.ok(h.innerHTML.includes('min-height:44px'));
    assert.ok(h.innerHTML.indexOf('FinOwn') < h.innerHTML.indexOf('Bravo') && h.innerHTML.indexOf('Bravo') < h.innerHTML.indexOf('Alpha'));
    assert.ok(h.innerHTML.includes('recorded by Uriel') && h.innerHTML.includes('GCash') && h.innerHTML.includes('₱65,000.00'));
  });
  it('Finance sees the stand-in header and note, and not the order she recorded herself', async () => {
    const env = makeEnv(FIN, { seed: seed() }); const h = host();
    await env.ctx.window.renderPaymentConfirmList(h, {});
    assert.ok(h.innerHTML.includes('Payments to confirm — President\'s stand-in'));
    assert.ok(h.innerHTML.includes('The President normally confirms payments. Confirm only if he cannot be reached. He will be told that you confirmed it.'));
    assert.ok(!h.innerHTML.includes('alert-banner'), 'a small inline note, not a warning banner');
    assert.ok(!h.innerHTML.includes('FinOwn'));
    assert.ok(h.innerHTML.includes('<span class="badge badge-orange">2</span>'));
  });
  it('Sales, a manager and Production see nothing: the host is emptied', async () => {
    for (const who of [SALES, MGR, PROD]) {
      const env = makeEnv(who, { seed: seed() }); const h = host();
      await env.ctx.window.renderPaymentConfirmList(h, {});
      assert.equal(h.innerHTML, '', who.role + '/' + who.depts);
    }
  });
  it('an empty queue empties the host; no host at all is fine', async () => {
    const env = makeEnv(PRES, { seed: { sales_orders: {} } }); const h = host();
    await env.ctx.window.renderPaymentConfirmList(h, {});
    assert.equal(h.innerHTML, '');
    await env.ctx.window.renderPaymentConfirmList(null, {});
  });
  it('the card buttons open the sheet / the reject prompt and re-render through onDone', async () => {
    const env = makeEnv(PRES, { seed: seed() });
    const clicks = {};
    const mk = (cls) => ({ dataset: { id: 'a' }, addEventListener: (t, fn) => { clicks[cls] = fn; } });
    const h = { innerHTML: '', querySelectorAll: (sel) => (sel === '.pcl-open' ? [mk('open')] : sel === '.pcl-reject' ? [mk('reject')] : []) };
    let done = 0;
    await env.ctx.window.renderPaymentConfirmList(h, { onDone: () => { done++; } });
    clicks.open();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(env.lastPage().title, 'Confirm payment — Alpha');
    clicks.reject();
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(env.db.store.sales_orders.get('a').status, 'payment_rejected');
    assert.equal(done, 1);
  });
});

describe('Generate sales order & job order (§5.5, §14.3.3)', () => {
  const seedC = (o = {}, p = {}) => ({ sales_orders: { o1: pend({ status: 'recorded', recordedAmount: 65000, ...o }) }, job_projects: { prj1: proj({ amountCollected: 65000, arBalance: 35000, ...p }) } });
  const orderOf = (env) => ({ id: 'o1', ...env.db.store.sales_orders.get('o1') });
  async function sheet(who = SALES, { o = {}, p = {}, forms = null } = {}) {
    const env = makeEnv(who, { seed: seedC(o, p), forms });
    let done = 0;
    env.ctx.window.openGenerateOrderSheet(orderOf(env), () => { done++; });
    return { env, s: env.lastPage(), done: () => done };
  }
  const fill = async (s, env, { date = '2026-12-01', priority = 'High', notes = 'Build two tables, 304 SS', pick = 'client', file = true } = {}) => {
    s.$('gen-date').value = date; s.$('gen-priority').value = priority; s.$('gen-notes').value = notes;
    if (pick) await s.check('gen-dwg', pick);
    if (file) env.uploads['gen-dwg-upload'].cb({ url: 'https://d.example/dwg.pdf', name: 'dwg.pdf' });
  };

  it('opens only for a confirmed, unsent order; otherwise says why', async () => {
    for (const [o, msg] of [[{ status: 'pending' }, 'The payment has not been confirmed yet.'], [{ status: 'payment_rejected' }, 'The payment has not been confirmed yet.'], [{ sentToProduction: true }, 'This order was already sent on.'], [{ sentToDesign: true }, 'This order was already sent on.']]) {
      const env = makeEnv(SALES, { seed: seedC(o) });
      env.ctx.window.openGenerateOrderSheet(orderOf(env), () => {});
      assert.equal(env.pages.length, 0, JSON.stringify(o));
      assert.ok(env.toastMsgs().includes(msg), msg);
    }
  });
  it('shows the summary, prefilled target / priority / notes, the three drawing choices and the helper text for each', async () => {
    const { s } = await sheet(SALES, { o: { targetDate: '2026-12-05', priority: 'Urgent', notes: 'rush' } });
    assert.equal(s.title, 'Generate sales order & job order');
    assert.ok(s.html.includes('Acme Foods') && s.html.includes('1 item(s)') && s.html.includes('Payment confirmed ₱65,000.00 of ₱100,000.00'));
    assert.equal(s.$('gen-date').value, '2026-12-05'); assert.equal(s.$('gen-priority').value, 'Urgent'); assert.equal(s.$('gen-notes').value, 'rush');
    same(s.radios.map((r) => r.value), ['client', 'in_house', 'design']);
    for (const t of ['The client supplied the drawing', 'Our drawing is already done', 'Not drawn yet — send to Design first']) assert.ok(s.html.includes(t), t);
    assert.ok(s.$('gen-dwg-upload').classList.contains('hidden'), 'the uploader is hidden until a drawing is claimed');
    await s.check('gen-dwg', 'client');
    assert.ok(!s.$('gen-dwg-upload').classList.contains('hidden'));
    assert.ok(s.$('gen-dwg-help').textContent.startsWith('Goes straight to Production.'));
    await s.check('gen-dwg', 'design');
    assert.ok(s.$('gen-dwg-upload').classList.contains('hidden'));
    assert.ok(s.$('gen-dwg-help').textContent.startsWith('Design prepares the drawings; you approve them on the job; then it goes to Production.'));
  });
  it('(F6 on hold) the "send to Design" help tells Sales they can attach the drawing themselves — nothing assumes anyone is in Design', async () => {
    const { s } = await sheet(SALES);
    await s.check('gen-dwg', 'design');
    assert.ok(s.$('gen-dwg-help').textContent.includes('If nobody is available to draw it, tap Attach drawing on the order and add the drawing yourself.'));
  });
  it('requires target date, priority and notes, a drawing choice, and the file for (a)/(b)', async () => {
    const { env, s } = await sheet();
    await fill(s, env, { date: '', pick: 'client' });
    await s.$('gen-save').click(); assert.equal(s.$('gen-err').textContent, 'Target date, priority and notes are all required.');
    await fill(s, env, { pick: null, file: false }); s.radios.forEach((r) => { r.checked = false; });
    await s.$('gen-save').click(); assert.equal(s.$('gen-err').textContent, 'Say who made the drawing, or send it to Design first.');
    const b = await sheet(); await fill(b.s, b.env, { pick: 'in_house', file: false });
    await b.s.$('gen-save').click(); assert.equal(b.s.$('gen-err').textContent, 'Attach the drawing first.');
    b.s.$('gen-dwg-upload').dataset.busy = '1';
    await b.s.$('gen-save').click(); assert.equal(b.s.$('gen-err').textContent, 'Wait for the upload to finish.');
    assert.equal(b.env.db.log.filter((l) => l.op !== 'query').length, 0, 'nothing written on a validation error');
  });
  it('(a) client drawing: the drawing is stamped on the order and the job, the job goes to Production, the release is stamped', async () => {
    const { env, s, done } = await sheet(SALES);
    await fill(s, env, { pick: 'client' });
    await s.$('gen-save').click();
    assert.equal(s.$('gen-err').textContent, '');
    const o = env.db.store.sales_orders.get('o1');
    same([o.targetDate, o.priority, o.notes], ['2026-12-01', 'High', 'Build two tables, 304 SS']);
    same([o.handoffDrawing.source, o.handoffDrawing.url, o.handoffDrawing.name, o.handoffDrawing.by, o.handoffDrawing.byName], ['client', 'https://d.example/dwg.pdf', 'dwg.pdf', 'u-sales', 'Uriel']);
    assert.equal(o.sentToProduction, true); assert.ok(o.sentToProductionAt);
    assert.ok(o.releasedAt && o.releasedBy === 'u-sales' && o.releasedByName === 'Uriel');
    const pr = env.db.store.job_projects.get('prj1');
    assert.equal(pr.stage, 'in_production');
    same([pr.targetDate, pr.priority, pr.notes], ['2026-12-01', 'High', 'Build two tables, 304 SS']);
    assert.equal(pr.handoffDrawing.url, 'https://d.example/dwg.pdf');
    assert.ok(pr.releasedAt);
    assert.ok(pr.documents.some((d) => d.type === 'Client drawing' && d.ref === 'dwg.pdf'));
    assert.ok(pr.documents.some((d) => d.type === 'Sales Order' && d.ref === 'JP-2611-001'));
    assert.ok(pr.timeline.some((t) => t.event === 'Moved to In Production'));
    assert.ok(pr.timeline.some((t) => t.event === 'Sales order & job order generated'));
    assert.ok(!pr.timeline.some((t) => t.event.includes('₱')), 'no pesos in anything Production reads');
    const prod = env.notifs.find((n) => n.kind === 'dept' && n.dept === 'Production');
    assert.equal(prod.body, 'Acme Foods — client-supplied drawing attached. The job order is ready. Start the work order.');
    assert.ok(!prod.body.includes('₱'));
    same(prod.opts, { fallbackToOwner: true });
    same(env.tracking, [{ token: 'tok1', patch: { status: 'production' } }]);
    assert.ok(env.toastMsgs().includes('Sales order and job order generated — sent to Production'));
    assert.equal(done(), 1); assert.equal(env.closes, 1);
    assert.ok(env.audits.some((a) => a[2] === 'o1' && a[3].generated === true && a[3].drawing === 'client'));
    assert.equal(env.db.store.ledger, undefined, 'Generate never touches the ledger');
    // only keys the rules let Sales write on the order (parsed from firestore.rules itself)
    const allowed = salesAllowedKeys();
    for (const w of env.db.log.filter((l) => l.op === 'update' && l.path === 'sales_orders/o1')) for (const k of Object.keys(w.patch)) assert.ok(allowed.has(k), `Sales would be denied writing ${k}`);
  });
  it('(b) our own drawing: same hand-off, recorded as "Drawing"', async () => {
    const { env, s } = await sheet(SALES);
    await fill(s, env, { pick: 'in_house' });
    await s.$('gen-save').click();
    assert.equal(env.db.store.sales_orders.get('o1').handoffDrawing.source, 'in_house');
    assert.ok(env.db.store.job_projects.get('prj1').documents.some((d) => d.type === 'Drawing'));
    assert.ok(env.notifs.find((n) => n.dept === 'Production').body.includes('— drawing attached.'));
  });
  it('(c) not drawn yet: goes to Design (not Production), no drawing stamped, the sales order is still released', async () => {
    const { env, s } = await sheet(SALES);
    await fill(s, env, { pick: 'design', file: false });
    await s.$('gen-save').click();
    const o = env.db.store.sales_orders.get('o1');
    assert.equal(o.sentToDesign, true); assert.ok(!o.sentToProduction); assert.ok(!('handoffDrawing' in o));
    assert.ok(o.designProjectId); assert.ok(o.releasedAt);
    assert.equal(env.db.store.job_projects.get('prj1').stage, 'in_design');
    assert.ok(env.db.store.projects.size === 1, 'a Design-board project was created');
    const design = env.notifs.find((n) => n.dept === 'Design');
    assert.ok(design.body.includes('payment confirmed. Prepare the drawings, then send to Production.'));
    assert.ok(!design.body.includes('recorded by Finance'));
    same(design.opts, { fallbackToOwner: true }, 'with nobody in Design, the alert reaches the President instead of vanishing');
    assert.ok(env.db.store.job_projects.get('prj1').timeline.some((t) => t.event === 'Moved to In Design (payment confirmed)'));
    assert.ok(env.toastMsgs().includes('Sales order generated — sent to Design for drawings'));
    assert.ok(env.audits.some((a) => a[3] && a[3].generated === true && a[3].drawing === 'design'));
  });
  it('a hand-off that fails leaves the sheet open for a safe retry and does not stamp the release', async () => {
    const { env, s } = await sheet(SALES);
    await fill(s, env, { pick: 'client' });
    const real = env.db.collection.bind(env.db);
    let fail = true;
    env.db.collection = (c) => { const x = real(c); if (c !== 'sales_orders') return x; return { ...x, doc: (id) => { const d = x.doc(id); return { ...d, update: async (patch) => { if (fail && patch.sentToProduction) { fail = false; throw new Error('network down'); } return d.update(patch); } }; } }; };
    await s.$('gen-save').click();
    assert.ok(env.toastMsgs().some((m) => m.startsWith('Transfer failed: network down')));
    assert.equal(env.closes, 0, 'the sheet stays open');
    assert.ok(!env.db.store.sales_orders.get('o1').releasedAt, 'not released');
    await s.$('gen-save').click();                    // the retry
    assert.equal(env.db.store.sales_orders.get('o1').sentToProduction, true);
    assert.ok(env.db.store.sales_orders.get('o1').releasedAt);
    assert.equal(env.closes, 1);
  });
  it('another tap got there first: "already sent on", nothing written', async () => {
    const { env, s, done } = await sheet(SALES);
    await fill(s, env, { pick: 'client' });
    await env.db.collection('sales_orders').doc('o1').update({ sentToProduction: true });
    env.db.log.length = 0;
    await s.$('gen-save').click();
    assert.ok(env.toastMsgs().includes('This order was already sent on.'));
    assert.equal(env.db.log.filter((l) => l.op !== 'query').length, 0);
    assert.equal(done(), 1);
  });
  it('(FLOW-FORM-HOOK) with the form engine: numbers and offers the sales order + job order (+ hand-off pack) for (a)/(b), the sales order only for (c)', async () => {
    const calls = [];
    const forms = { assignNumbers: async (k, a) => calls.push(['assign', k, a]), offer: async (k, a) => calls.push(['offer', k, a]) };
    const a = await sheet(SALES, { forms }); await fill(a.s, a.env, { pick: 'client' }); await a.s.$('gen-save').click();
    same(calls, [['assign', ['sales_order', 'job_order'], { orderId: 'o1', projectId: 'prj1' }], ['offer', ['sales_order', 'job_order', 'handoff_pack'], { orderId: 'o1', projectId: 'prj1' }]]);
    calls.length = 0;
    const c = await sheet(SALES, { forms }); await fill(c.s, c.env, { pick: 'design', file: false }); await c.s.$('gen-save').click();
    same(calls, [['assign', ['sales_order'], { orderId: 'o1', projectId: 'prj1' }], ['offer', ['sales_order'], { orderId: 'o1', projectId: 'prj1' }]]);
  });
  it('(FLOW-FORM-HOOK) with no form engine, or one that throws, Generate still completes', async () => {
    const none = await sheet(SALES); await fill(none.s, none.env, { pick: 'client' }); await none.s.$('gen-save').click();
    assert.ok(none.env.ensured.includes('js/forms.js'));
    assert.equal(none.env.db.store.sales_orders.get('o1').sentToProduction, true);
    const bad = await sheet(SALES, { forms: { assignNumbers: async () => { throw new Error('boom'); }, offer: async () => {} } });
    await fill(bad.s, bad.env, { pick: 'client' }); await bad.s.$('gen-save').click();
    assert.equal(bad.env.db.store.sales_orders.get('o1').sentToProduction, true);
    assert.ok(bad.env.toastMsgs().includes('Sales order and job order generated — sent to Production'));
  });
});

describe('Attach drawing — an order "sent to Design" never waits on Design staffing (owner: F6 on hold)', () => {
  const seedD = (o = {}, p = {}) => ({
    sales_orders: { o1: pend({ status: 'recorded', recordedAmount: 65000, sentToDesign: true, designProjectId: 'dp1', targetDate: '2026-12-01', priority: 'High', notes: 'Build two tables', ...o }) },
    job_projects: { prj1: proj({ stage: 'in_design', amountCollected: 65000, arBalance: 35000, ...p }) },
    projects: { dp1: { name: 'Acme — JP', salesOrderId: 'o1', productionHandoffAt: null, needsDrawings: null, createdBy: 'u-sales' } },
  });
  async function sheet(who = SALES, { o = {}, p = {}, forms = null } = {}) {
    const env = makeEnv(who, { seed: seedD(o, p), forms });
    let done = 0;
    env.ctx.window.openAttachDrawingSheet({ id: 'o1', ...env.db.store.sales_orders.get('o1') }, () => { done++; });
    return { env, s: env.lastPage(), done: () => done };
  }
  const fill = async (s, env, pick = 'client', file = true) => { if (pick) await s.check('att-dwg', pick); if (file) env.uploads['att-dwg-upload'].cb({ url: 'https://d.example/ours.pdf', name: 'ours.pdf' }); };

  it('Sales attaches the drawing and the job goes straight to Production — Design is not needed', async () => {
    const { env, s, done } = await sheet(SALES);
    await fill(s, env, 'in_house');
    await s.$('att-save').click();
    assert.equal(s.$('att-err').textContent, '');
    const o = env.db.store.sales_orders.get('o1');
    assert.equal(o.handoffDrawing.source, 'in_house'); assert.equal(o.handoffDrawing.url, 'https://d.example/ours.pdf');
    assert.equal(o.sentToProduction, true);
    const pr = env.db.store.job_projects.get('prj1');
    assert.equal(pr.stage, 'in_production');
    assert.equal(pr.handoffDrawing.url, 'https://d.example/ours.pdf');
    assert.ok(pr.documents.some((d) => d.type === 'Drawing' && d.ref === 'ours.pdf'));
    const dp = env.db.store.projects.get('dp1');
    assert.ok(dp.productionHandoffAt, 'the Design board stops listing it as awaiting design');
    assert.equal(dp.needsDrawings, false);
    const prod = env.notifs.find((n) => n.dept === 'Production');
    assert.equal(prod.body, 'Acme Foods — drawing attached. The job order is ready. Start the work order.');
    assert.ok(env.toastMsgs().includes('Drawing attached — sent to Production'));
    assert.equal(done(), 1); assert.equal(env.closes, 1);
    // nothing this does needs a Design-department user, and Sales' writes stay inside the rules' Sales key list
    const allowed = salesAllowedKeys();
    for (const w of env.db.log.filter((l) => l.op === 'update' && l.path === 'sales_orders/o1')) for (const k of Object.keys(w.patch)) assert.ok(allowed.has(k), `Sales would be denied writing ${k}`);
  });
  it('requires whose drawing it is and the file, and writes nothing until it has both', async () => {
    const { env, s } = await sheet(SALES);
    await s.$('att-save').click(); assert.equal(s.$('att-err').textContent, 'Say whose drawing it is.');
    await fill(s, env, 'client', false);
    await s.$('att-save').click(); assert.equal(s.$('att-err').textContent, 'Attach the drawing first.');
    assert.equal(env.db.log.filter((l) => l.op !== 'query').length, 0);
  });
  it('only an order that is with Design (flow 2, confirmed, not yet in production) can use it', async () => {
    for (const o of [{ sentToDesign: false }, { sentToProduction: true }, { status: 'pending' }, { flowVersion: undefined }]) {
      const env = makeEnv(SALES, { seed: seedD(o) });
      env.ctx.window.openAttachDrawingSheet({ id: 'o1', ...env.db.store.sales_orders.get('o1') }, () => {});
      assert.equal(env.pages.length, 0, JSON.stringify(o));
      assert.ok(env.toastMsgs().includes('This order is not waiting for drawings.'));
    }
  });
  it('a stale sheet (the order was sent on meanwhile) writes nothing', async () => {
    const { env, s } = await sheet(SALES);
    await fill(s, env);
    await env.db.collection('sales_orders').doc('o1').update({ sentToProduction: true });
    env.db.log.length = 0;
    await s.$('att-save').click();
    assert.ok(env.toastMsgs().includes('This order was already sent on.'));
    assert.equal(env.db.log.filter((l) => l.op !== 'query').length, 0);
  });
  it('the Design-board close-out is best-effort: when the board refuses the write, the hand-off still completes', async () => {
    const { env, s } = await sheet(SALES);
    const real = env.db.collection.bind(env.db);
    env.db.collection = (c) => { const x = real(c); if (c !== 'projects') return x; return { ...x, doc: (id) => ({ ...x.doc(id), update: async () => { throw new Error('permission-denied'); } }) }; };
    await fill(s, env);
    await s.$('att-save').click();
    assert.equal(env.db.store.sales_orders.get('o1').sentToProduction, true);
    assert.ok(env.toastMsgs().includes('Drawing attached — sent to Production'));
  });
  it('(FLOW-FORM-HOOK) numbers and offers the job order afterwards; a missing engine changes nothing', async () => {
    const calls = [];
    const a = await sheet(SALES, { forms: { assignNumbers: async (k, x) => calls.push(['assign', k, x]), offer: async (k, x) => calls.push(['offer', k, x]) } });
    await fill(a.s, a.env); await a.s.$('att-save').click();
    same(calls, [['assign', ['job_order'], { orderId: 'o1', projectId: 'prj1' }], ['offer', ['job_order', 'handoff_pack'], { orderId: 'o1', projectId: 'prj1' }]]);
    const b = await sheet(SALES); await fill(b.s, b.env); await b.s.$('att-save').click();
    assert.equal(b.env.db.store.sales_orders.get('o1').sentToProduction, true);
  });
});

// The real hand-off helper opens a "before sending to Production" panel and WAITS for a tap when the hand-off fields are missing. If the
// unconfirmed-payment guard ever broke, that wait would hang the whole suite instead of failing it, so race it against a short timer.
const orHung = (p, ms = 1500) => Promise.race([p, new Promise((r) => setTimeout(() => r('HUNG: the helper is waiting on a panel instead of refusing'), ms))]);

describe('the hand-off helpers (§5.5): nothing moves before the payment is confirmed', () => {
  it('transferOrderToProduction refuses an unconfirmed flow-2 order BEFORE any write, with the reason', async () => {
    const env = makeEnv(SALES, { seed: { sales_orders: { o1: pend() }, job_projects: { prj1: proj() } } });
    const ok = await orHung(env.ctx.transferOrderToProduction({ id: 'o1', ...env.db.store.sales_orders.get('o1') }));
    assert.equal(ok, false);
    assert.ok(env.toastMsgs().includes('The payment has not been confirmed yet.'));
    assert.equal(env.db.log.filter((l) => l.op !== 'query').length, 0);
    assert.equal(env.pages.length, 0, 'not even the "before sending to Production" panel opens');
  });
  it('transferOrderToDesign refuses it too', async () => {
    const env = makeEnv(SALES, { seed: { sales_orders: { o1: pend({ status: 'payment_rejected' }) }, job_projects: { prj1: proj() } } });
    const ok = await env.ctx.window.transferOrderToDesign({ id: 'o1', ...env.db.store.sales_orders.get('o1') });
    assert.equal(ok, false);
    assert.ok(env.toastMsgs().includes('The payment has not been confirmed yet.'));
    assert.equal(env.db.log.filter((l) => l.op !== 'query').length, 0);
  });
  it('a LEGACY order is not blocked (Finance\'s existing hand-off keeps working)', async () => {
    const env = makeEnv(FIN, { seed: { sales_orders: { o1: pend({ flowVersion: undefined, status: 'recorded', recordedAmount: 65000 }) }, job_projects: { prj1: proj({ flowVersion: undefined }) }, projects: {} } });
    const ok = await env.ctx.window.transferOrderToDesign({ id: 'o1', ...env.db.store.sales_orders.get('o1') });
    assert.equal(ok, true);
    assert.equal(env.db.store.sales_orders.get('o1').sentToDesign, true);
    assert.ok(env.notifs.find((n) => n.dept === 'Design').body.includes('payment confirmed'));
  });
  it('without a hand-off drawing, the old Sales-approval gate still applies (the drawing is the new way past it, not the only one)', async () => {
    const env = makeEnv(SALES, { seed: { sales_orders: { o1: pend({ status: 'recorded', targetDate: '2026-12-01', priority: 'High', notes: 'n' }) }, job_projects: { prj1: proj({ stage: 'in_design' }) } } });
    const ok = await env.ctx.transferOrderToProduction({ id: 'o1', ...env.db.store.sales_orders.get('o1') });
    assert.equal(ok, false);
    assert.ok(env.toastMsgs().some((m) => m.startsWith('Send the drawings to Sales for approval first')));
    assert.equal(env.db.store.job_projects.get('prj1').stage, 'in_design');
  });
  it('with noDrawingsNeeded the gate is skipped, and the Production notice says so', async () => {
    const env = makeEnv(SALES, { seed: { sales_orders: { o1: pend({ status: 'recorded', targetDate: '2026-12-01', priority: 'High', notes: 'n', noDrawingsNeeded: true }) }, job_projects: { prj1: proj() } } });
    assert.equal(await env.ctx.transferOrderToProduction({ id: 'o1', ...env.db.store.sales_orders.get('o1') }), true);
    assert.equal(env.notifs.find((n) => n.dept === 'Production').body, 'Acme Foods — no drawings needed. The job order is ready. Start the work order.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('clear error states and no dead buttons (owner quality bar)', () => {
  it('a failed Sales Orders read says so, with a Try again button that re-renders — it does not pass for "No sales orders yet"', async () => {
    const env = makeEnv(PRES, { seed: { sales_orders: { o1: pend() }, job_projects: { prj1: proj() } } });
    const real = env.db.collection.bind(env.db);
    let fail = true;
    env.db.collection = (c) => (c === 'sales_orders' ? { orderBy: () => ({ get: async () => { if (fail) throw new Error('permission-denied'); return real(c).get(); } }) } : real(c));
    const handlers = [];
    const c = { innerHTML: '', querySelectorAll: (sel) => (sel === '.so-retry-btn' ? [{ addEventListener: (t, fn) => handlers.push(fn) }] : []) };
    await env.ctx.window.renderSalesOrders(c);
    assert.ok(c.innerHTML.includes("Couldn't load sales orders") && c.innerHTML.includes('permission-denied') && c.innerHTML.includes('Try again'));
    assert.ok(!c.innerHTML.includes('No sales orders yet'));
    assert.equal(handlers.length, 1);
    fail = false;
    handlers[0]();
    await new Promise((r) => setTimeout(r, 25));
    assert.ok(c.innerHTML.includes('Acme Foods'), 'the retry loaded the list');
  });
  it('a failed "Payments to confirm" read shows an error with Try again — not an empty list that looks like "nothing to confirm"', async () => {
    const env = makeEnv(PRES, { seed: { sales_orders: { a: pend({ clientName: 'Alpha' }) } } });
    let fail = true;
    env.ctx.dbCachedGet = async (k, f) => { if (fail) throw new Error('offline'); return f(); };
    const handlers = [];
    const h = { innerHTML: 'x', querySelectorAll: (sel) => (sel === '.pcl-retry' ? [{ addEventListener: (t, fn) => handlers.push(fn) }] : []) };
    await env.ctx.window.renderPaymentConfirmList(h, {});
    assert.ok(h.innerHTML.includes('Could not load the payments waiting for confirmation.') && h.innerHTML.includes('Try again'));
    assert.ok(!h.innerHTML.includes('Alpha'));
    fail = false;
    handlers[0]();
    await new Promise((r) => setTimeout(r, 25));
    assert.ok(env.invalidated.includes('approvals-pending:sales_orders-pending'), 'the retry drops the cached failure');
    assert.ok(h.innerHTML.includes('Alpha') && h.innerHTML.includes('pcl-open'));
  });
  it('the unconfirmed-payments loader used by the dashboard banner never throws (a failed read is an empty list)', async () => {
    const env = makeEnv(PRES, { seed: {} });
    env.ctx.dbCachedGet = async () => { throw new Error('offline'); };
    same(await env.ctx.window.pendingPaymentConfirmations(), []);
  });
  it('if the company bank accounts cannot be loaded, the confirm sheet does not open — it says why', async () => {
    const env = makeEnv(PRES, { seed: seed2() });
    env.ctx.BankAccounts.list = async () => { throw new Error('offline'); };
    await env.ctx.window.openPaymentConfirmSheet({ id: 'o1', ...env.db.store.sales_orders.get('o1') }, () => {});
    assert.equal(env.pages.length, 0);
    assert.ok(env.toasts.some((t) => t.type === 'error' && t.msg.startsWith('Could not load the company bank accounts')));
  });
  it('a busy button shows its work: Record payment, Confirm and Generate re-enable and report a failure inline rather than hang', async () => {
    const env = makeEnv(SALES, { seed: { bk_quotes: { q1: quote() } } });
    env.ctx.createJobProject = async () => { throw new Error('network down'); };
    await env.ctx.openSalesOrderModal(dataset, env.ctx.currentUser, 'employee', container());
    const p = env.lastPage();
    p.$('so-paid').value = '65000'; env.uploads['so-receipt-upload'].cb({ url: 'https://r.example/r.pdf', name: 'r.pdf' });
    await p.$('so-save').click();
    assert.equal(p.$('so-err').textContent, 'Failed: network down');
    assert.ok(!p.$('so-err').classList.contains('hidden'));
    assert.equal(env.db.store.sales_orders, undefined, 'nothing half-written');
  });

  // A button with an id and no click handler (and no inline onclick) is a dead button. Walk every sheet the flow opens.
  const dead = (panel) => Object.values(panel.els).filter((e) => e.tag === 'button' && !(e._h.click && e._h.click.length) && !new RegExp(`id="${e.id}"[^>]*onclick=`).test(panel.html)).map((e) => e.id);
  it('every button on every sheet is wired (Record payment, Edit payment, Confirm, Generate, Attach drawing)', async () => {
    const a = makeEnv(SALES, { seed: { bk_quotes: { q1: quote() } } });
    await a.ctx.openSalesOrderModal(dataset, a.ctx.currentUser, 'employee', container());
    same(dead(a.lastPage()), []);
    const b = makeEnv(SALES, { seed: seed2() });
    await b.ctx.openSalesOrderModal({ id: 'q1', qno: 'x', client: 'Acme Foods', clientId: '', total: 100000, co: 'BK' }, b.ctx.currentUser, 'employee', container(), { id: 'o1', ...b.db.store.sales_orders.get('o1') });
    same(dead(b.lastPage()), []);
    for (const who of [PRES, FIN]) {
      const c = makeEnv(who, { seed: seed2() });
      await c.ctx.window.openPaymentConfirmSheet({ id: 'o1', ...c.db.store.sales_orders.get('o1') }, () => {});
      same(dead(c.lastPage()), [], who.role);
      assert.ok('pc-confirm' in c.lastPage().els && 'pc-reject' in c.lastPage().els);
    }
    const g = makeEnv(SALES, { seed: { sales_orders: { o1: pend({ status: 'recorded' }) }, job_projects: { prj1: proj() } } });
    g.ctx.window.openGenerateOrderSheet({ id: 'o1', ...g.db.store.sales_orders.get('o1') }, () => {});
    same(dead(g.lastPage()), []);
    const d = makeEnv(SALES, { seed: { sales_orders: { o1: pend({ status: 'recorded', sentToDesign: true }) }, job_projects: { prj1: proj({ stage: 'in_design' }) } } });
    d.ctx.window.openAttachDrawingSheet({ id: 'o1', ...d.db.store.sales_orders.get('o1') }, () => {});
    same(dead(d.lastPage()), []);
  });
  it('every class-bound button the Sales Orders page draws has a handler in its code (no dead buttons in any state, for any viewer)', async () => {
    const wired = ['so-link-btn', 'so-del-btn', 'so-confirm-btn', 'so-reject-btn', 'so-editpay-btn', 'so-generate-btn', 'so-attach-btn', 'so-jo-btn', 'so-record-btn', 'so-design-btn', 'so-retry-btn'];
    const seenClasses = new Set();
    for (const who of [PRES, SALES, FIN, MGR, PROD]) {
      const env = makeEnv(who, { seed: { sales_orders: {
        a: pend(), b: pend({ status: 'payment_rejected', paymentConfirm: { decision: 'rejected', reason: 'r' } }), c: pend({ status: 'recorded' }),
        d: pend({ status: 'recorded', sentToDesign: true }), e: pend({ status: 'recorded', sentToProduction: true }), f: pend({ flowVersion: undefined }),
        g: pend({ flowVersion: undefined, status: 'recorded' }) }, job_projects: { prj1: proj() } } });
      const html = await renderOrders(env);
      for (const m of html.matchAll(/<button[^>]*class="[^"]*\b(so-[a-z-]+-btn)\b/g)) seenClasses.add(m[1]);
    }
    assert.ok(seenClasses.size >= 8, 'the matrix drew the buttons');
    const code = DEPT;
    for (const cls of seenClasses) {
      assert.ok(wired.includes(cls), `unknown button class ${cls}`);
      assert.ok(new RegExp(`querySelectorAll\\('\\.${cls}'\\)`).test(code), `${cls} is drawn but nothing in departments.js binds it`);
    }
  });
});
const seed2 = () => ({ sales_orders: { o1: pend() }, job_projects: { prj1: proj() } });

describe('the page refreshes itself after a payment is fixed (the router opens it with no container argument)', () => {
  it('Fix & resubmit re-renders THIS page, so the row changes to "Awaiting confirmation" without leaving and coming back', async () => {
    const env = makeEnv(SALES, { seed: { sales_orders: { o1: pend({ status: 'payment_rejected', paymentConfirm: { decision: 'rejected', reason: 'wrong amount', resubmits: 0 } }) }, job_projects: { prj1: proj() } } });
    let editHandler = null;
    const c = { innerHTML: '', querySelectorAll: (sel) => (sel === '.so-editpay-btn' ? [{ dataset: { id: 'o1' }, addEventListener: (t, fn) => { editHandler = fn; } }] : []) };
    env.ctx.deptContainer = () => c;
    await env.ctx.window.renderSalesOrders();                      // exactly how navigateTo calls it
    assert.ok(c.innerHTML.includes('Payment rejected') && c.innerHTML.includes('wrong amount'));
    assert.ok(editHandler, 'the Fix & resubmit button is wired');
    editHandler();
    await new Promise((r) => setTimeout(r, 25));
    const p = env.lastPage();
    assert.ok(p && p.$('so-save'), 'the Edit payment modal opened');
    p.$('so-paid').value = '60000';
    await p.$('so-save').click();
    await new Promise((r) => setTimeout(r, 25));
    assert.ok(c.innerHTML.includes('Awaiting confirmation'), 'the list now shows the resubmitted payment');
    assert.ok(!c.innerHTML.includes('Payment rejected'));
  });
});
