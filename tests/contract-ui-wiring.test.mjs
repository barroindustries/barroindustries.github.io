// tests/contract-ui-wiring.test.mjs — F3 "Revise contract amount", the screens and their hooks (specs/SALES-FLOW-SPEC-2026-11-19.md §7, §12, §13.2 Phase 2).
//
//   1. WIRING     sw.js precaches the three new files; none is an index.html script (lazy, CLAUDE.md "app-kit" rule); the hooks in departments.js,
//                 approvals.js, dashboards.js, production.js, notifications.js are small, guarded and lazy; the deleteSalesOrder guard is the first thing
//                 after the id check; the Production notification and the labels carry no peso and never say "Rev." (owner SF23: "R1").
//   2. BEHAVIOUR  js/contract-ui.js, js/contract-core.js, js/price-gate-core.js and js/sales-flow-core.js run for real in the shared Sales harness
//                 (in-memory Firestore, Ledger.post with the real contract, recorded toasts and notifications): send a request -> pendingRevision shape;
//                 approve -> one SO-<id>-R1 row and the order / job updated; a double tap applies once; send back; only the President approves a
//                 price approval; a stand-in confirms a no-approval change; one open request; withdraw; a zero-difference revision; refund.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PRES, SALES, FIN, makeBaseEnv, read, same } from './fixtures/sales-flow-harness.mjs';

const SW = read('sw.js'), DEPT = read('js/departments.js'), APPR = read('js/screens/approvals.js'), DASH = read('js/screens/dashboards.js');
const PROD = read('js/screens/production.js'), NOTIF = read('js/notifications.js'), UI = read('js/contract-ui.js'), HTML = read('index.html');

describe('1. wiring', () => {
  const precache = (() => { const m = SW.match(/const PRECACHE = \[([\s\S]*?)\n\];/); return [...m[1].matchAll(/^\s*'([^']+)',?\s*(?:\/\/.*)?$/gm)].map((x) => x[1]); })();
  it('sw.js precaches price-gate-core, contract-core and contract-ui on their own lines, after the forms lines', () => {
    const at = ['/js/pdf-lite.js', '/js/forms-pdf.js', '/js/price-gate-core.js', '/js/contract-core.js', '/js/contract-ui.js'].map((f) => precache.indexOf(f));
    assert.ok(at.every((i) => i >= 0), String(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    for (const f of ['/js/price-gate-core.js', '/js/contract-core.js', '/js/contract-ui.js']) assert.ok(SW.includes(`\n  '${f}',\n`), f);
  });
  it('contract-ui is LAZY: not an index.html script, not in the app kit', () => {
    assert.doesNotMatch(HTML, /contract-ui\.js/);
    assert.doesNotMatch(HTML, /contract-core\.js/);
    assert.match(UI, /ensureScript\('js\/price-gate-core\.js'\)/);
    assert.match(UI, /ensureScript\('js\/contract-core\.js'\)/);
  });
  it('the Sales Orders hooks are guarded, lazy and gated: Sales members + President, status recorded, job not paid / cancelled', () => {
    assert.match(DEPT, /if \(o\.status === 'recorded' && \(isSalesActor \|\| isPres\) && _pj && !\['paid','cancelled'\]\.includes\(_pj\.stage\)\) b\.push\(`<button class="btn-secondary btn-sm so-revise-btn"/);
    assert.match(DEPT, /try \{ const _pj = o\.projectId \? projById\[o\.projectId\] : null; if \(o\.status === 'recorded'/);
    assert.match(DEPT, /ensureScript\('js\/contract-ui\.js'\); await window\.ContractUI\.openReviseSheet\(o, rerender\)/);
    assert.match(DEPT, /try \{ if \(c\.querySelector\('\.so-adj'\)\) window\.ensureScript\('js\/contract-ui\.js'\)/);
  });
  it('deleteSalesOrder refuses an order with revisions or a waiting request as its first guard (§7.9)', () => {
    const fn = DEPT.slice(DEPT.indexOf('window.deleteSalesOrder = async function'));
    const body = fn.slice(fn.indexOf('{') + 1, fn.indexOf('{') + 900).replace(/\s*\/\/[^\n]*/g, '');
    const iId = body.indexOf('if (!o || !o.id) return;'), iGuard = body.indexOf("(Number(o.contractRev) || 0) > 0 || o.pendingRevision"), iPres = body.indexOf('isRealPresident');
    assert.ok(iId >= 0 && iGuard > iId && iPres > iGuard, 'id check, then the revisions guard, then the President check');
    assert.match(body, /This order has contract revisions\. Cancel the job instead\./);
  });
  it('Approvals and the dashboard: one host div + one guarded lazy call each', () => {
    assert.equal((APPR.match(/id="approvals-contractchange"/g) || []).length, 1);
    assert.match(APPR, /try \{ window\.ensureScript\('js\/contract-ui\.js'\)\.then\(\(\) => window\.ContractUI\.renderDecisionBlock\(/);
    assert.equal((DASH.match(/id="dash-contractchange"/g) || []).length, 1);
    assert.match(DASH, /try \{ window\.ensureScript\('js\/contract-ui\.js'\)\.then\(\(\) => window\.ContractUI\.renderBanner\(/);
  });
  it('Production: the JO banner, the "Edit n" label, and notification types', () => {
    assert.match(PROD, /p\.jobOrder && p\.jobOrder\.scopeReviewNeeded/);
    assert.match(PROD, /The scope changed\.<\/strong> Review the lines, then save\./);
    assert.match(PROD, /'Edit ' \+ d\.revision/);
    assert.doesNotMatch(PROD, /'Revision ' \+ d\.revision/);
    for (const t of ['contract_change', 'contract_applied', 'contract_rejected']) assert.match(NOTIF, new RegExp(t + ':\\{icon'));
  });
  it('the Production notification carries no peso and no amount; no label says "Rev." (SF23)', () => {
    const at = UI.indexOf("sendToDept('Production'");
    const call = UI.slice(at, UI.indexOf('fallbackToOwner', at));
    assert.ok(at > 0);
    assert.doesNotMatch(call, /₱|money\(|result\.(from|to)|fromAmount|toAmount/);
    assert.doesNotMatch(UI, /Rev\./);
    assert.match(UI, /rLabel = function \(n\) \{ return 'R' \+ n; \}/);
  });
  it('every dynamic value in an HTML string goes through esc() or money(); toasts are plain text', () => {
    assert.doesNotMatch(UI, /innerHTML\s*=\s*[^;]*\$\{/);
    assert.doesNotMatch(UI, /toast\([^)]*<[a-z]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
const order = (o = {}) => ({ projectId: 'prj1', quoteId: 'q1', quoteNumber: 'BK-1', soNumber: 'SO-0012', clientName: 'Acme Foods', company: 'BK', contractAmount: 100000, status: 'recorded', flowVersion: 2, createdBy: 'u-sales', trackingToken: 'tok1', items: [{ name: 'Table', qty: 2 }], ...o });
const project = (o = {}) => ({ projectNo: 'JP-1', joNumber: 'JO-0012', stage: 'in_production', contractAmount: 100000, amountCollected: 65000, arBalance: 35000, flowVersion: 2, items: [{ name: 'Table', qty: 2 }], payments: [{ amount: 65000, date: '2026-11-18' }], documents: [], timeline: [], ...o });
const quote = (o = {}) => ({ quoteNumber: 'BK-1', company: 'BK', total: 100000, rootQuoteId: 'q1', approvalStatus: 'approved', approvedBy: 'u-pres', items: [{ name: 'Table', qty: 2 }], ...o });
const pending = (o = {}) => ({ revNo: 1, kind: 'manual', fromAmount: 100000, toAmount: 120000, delta: 20000, changeReason: 'Client added a shelf', quoteId: null, quoteColl: null, quoteNumber: null, changeOrderId: null, gate: { approval: 'none', reason: '', lastApproved: 100000, stdTotal: null, collected: 65000 }, status: 'pending_confirm', requestedAt: '2026-11-19T01:00:00.000Z', requestedBy: 'u-sales', requestedByName: 'Uriel', resubmits: 0, prevReason: '', decision: null, ...o });

function env(who, { so = {}, pj = {}, extra = {}, seed = {}, ...opts } = {}) {
  const e = makeBaseEnv(who, { seed: { sales_orders: { so1: order(so) }, job_projects: { prj1: project(pj) }, bk_quotes: { q1: quote() }, ...seed }, ...opts });
  const c = e.ctx;
  c.canEditDept = (d) => who.role === 'president' || (who.depts || []).includes(d);
  c.navigateTo = () => {};
  e.load(read('js/price-gate-core.js'), 'js/price-gate-core.js');
  e.load(read('js/contract-core.js'), 'js/contract-core.js');
  e.load(read('js/contract-ui.js'), 'js/contract-ui.js');
  Object.assign(c, extra);
  e.UI = c.ContractUI;
  e.so = () => e.db.store.sales_orders.get('so1');
  e.pj = () => e.db.store.job_projects.get('prj1');
  e.ledger = () => [...(e.db.store.ledger || new Map()).entries()];
  return e;
}
const send = async (e, { val, reason = 'Client added a shelf', mode } = {}) => {
  await e.UI.openReviseSheet({ id: 'so1' });
  const p = e.lastPage();
  await p.check('rv-choice', 'manual');
  if (mode) p.$('rv-mode').value = mode;
  p.$('rv-val').value = String(val); p.$('rv-reason').value = reason;
  await p.$('rv-send').click();
  return p;
};
const withPending = (o) => ({ so: { pendingRevision: pending(o) } });

describe('2. send a request (§7.2, §10.1)', () => {
  it('a no-approval raise writes pendingRevision in the §10.1 shape, status pending_confirm, and touches only pendingRevision + updatedAt', async () => {
    const e = env(SALES);
    await send(e, { val: 120000 });
    const pr = e.so().pendingRevision;
    assert.ok(pr, e.toastMsgs().join('|'));
    assert.equal(pr.revNo, 1); assert.equal(pr.kind, 'manual'); assert.equal(pr.fromAmount, 100000); assert.equal(pr.toAmount, 120000); assert.equal(pr.delta, 20000);
    assert.equal(pr.status, 'pending_confirm'); assert.equal(pr.changeReason, 'Client added a shelf'); assert.equal(pr.requestedBy, 'u-sales'); assert.equal(pr.decision, null);
    same(pr.gate, { approval: 'none', reason: '', lastApproved: 100000, stdTotal: null, collected: 65000 });
    for (const k of ['quoteId', 'quoteColl', 'quoteNumber', 'changeOrderId', 'resubmits', 'prevReason', 'requestedAt', 'requestedByName']) assert.ok(k in pr, k);
    const w = e.db.writes('sales_orders/so1').filter((l) => l.op === 'update');
    same(Object.keys(w[0].patch).sort(), ['pendingRevision', 'updatedAt']);
    assert.equal(e.ledger().length, 0, 'a request writes no money');
    assert.ok(e.notifs.some((n) => n.kind === 'owner') && e.notifs.some((n) => n.kind === 'dept' && n.dept === 'Finance'), 'Neil and Finance are told');
  });
  it('a cut below the approved price (cost unknown) goes to the President: pending_approval, Finance not asked', async () => {
    const e = env(SALES);
    await send(e, { val: 90000 });
    assert.equal(e.so().pendingRevision.status, 'pending_approval');
    assert.equal(e.so().pendingRevision.gate.approval, 'president');
    assert.ok(!e.notifs.some((n) => n.kind === 'dept' && n.dept === 'Finance'));
  });
  it('the difference mode: +20000 is 120000; a new amount below what was collected is the President\'s, reason overpayment', async () => {
    const e = env(SALES);
    await send(e, { val: 20000, mode: 'diff' });
    assert.equal(e.so().pendingRevision.toAmount, 120000);
    const e2 = env(SALES);
    await send(e2, { val: 50000 });
    assert.equal(e2.so().pendingRevision.gate.reason, 'overpayment');
    assert.equal(e2.so().pendingRevision.status, 'pending_approval');
  });
  it('the reason must be 5-300 characters; nothing is written otherwise', async () => {
    const e = env(SALES);
    await send(e, { val: 120000, reason: 'no' });
    assert.equal(e.so().pendingRevision, undefined);
  });
  it('one open request per order: a second is refused with "A contract change is already waiting"', async () => {
    const e = env(SALES, withPending());
    await e.UI.openReviseSheet({ id: 'so1' });
    assert.ok(e.toastMsgs().includes('A contract change is already waiting.'));
    assert.equal(e.pages.length, 0);
  });
  it('only Sales or the President can open the sheet; not before the payment is confirmed; not on a closed job', async () => {
    const e = env(FIN); await e.UI.openReviseSheet({ id: 'so1' }); assert.equal(e.pages.length, 0);
    const e2 = env(SALES, { so: { status: 'pending' } }); await e2.UI.openReviseSheet({ id: 'so1' }); assert.equal(e2.pages.length, 0);
    const e3 = env(SALES, { pj: { stage: 'paid' } }); await e3.UI.openReviseSheet({ id: 'so1' }); assert.equal(e3.pages.length, 0);
  });
  it('a sent-back request opens prefilled; sending again counts resubmits and keeps the earlier reason; Withdraw deletes the field', async () => {
    const e = env(SALES, withPending({ status: 'rejected', decision: 'rejected', reason: 'too low', decidedByName: 'Neil Barro' }));
    await e.UI.openReviseSheet({ id: 'so1' });
    const p = e.lastPage();
    assert.match(p.html, /too low/);
    p.$('rv-val').value = '125000';
    await p.check('rv-choice', 'manual');
    await p.$('rv-send').click();
    assert.equal(e.so().pendingRevision.resubmits, 1); assert.equal(e.so().pendingRevision.prevReason, 'too low'); assert.equal(e.so().pendingRevision.status, 'pending_confirm');
    const e2 = env(SALES, withPending({ status: 'rejected', decision: 'rejected', reason: 'too low' }));
    await e2.UI.withdraw({ id: 'so1' });
    assert.equal(e2.so().pendingRevision, undefined);
  });
});

describe('3. approve / confirm (§7.4)', () => {
  it('the President approves: one ledger row SO-so1-R1 (difference only), order + job updated, payments untouched, Production told with no amount', async () => {
    const e = env(PRES, withPending());
    await e.UI.applyRevision({ id: 'so1', pendingRevision: pending() });
    const rows = e.ledger();
    assert.equal(rows.length, 1); assert.equal(rows[0][0], 'SO-so1-R1'); assert.equal(rows[0][1].amount, 20000);
    assert.equal(e.so().contractAmount, 120000); assert.equal(e.so().contractRev, 1); assert.equal(e.so().originalContractAmount, 100000);
    assert.equal(e.so().pendingRevision, undefined); assert.equal(e.so().revisions.length, 1); assert.equal(e.so().revisions[0].decision, 'confirmed');
    assert.equal(e.pj().contractAmount, 120000); assert.equal(e.pj().arBalance, 55000); assert.equal(e.pj().clientCredit, 0); assert.equal(e.pj().joRev, 1);
    assert.equal(e.pj().amountCollected, 65000); same(e.pj().payments, project().payments); assert.equal(e.pj().stage, 'in_production');
    assert.ok(e.pj().timeline[0].event.includes('SO-0012 R1') && !e.pj().timeline[0].event.includes('₱'));
    const prod = e.notifs.find((n) => n.kind === 'dept' && n.dept === 'Production');
    assert.ok(prod); assert.doesNotMatch(JSON.stringify(prod), /₱|120000|100000|20000/); assert.match(prod.body, /JO-0012 R1/);
    assert.ok(e.notifs.some((n) => n.kind === 'send' && n.to === 'u-sales'), 'the proposer is told');
    assert.ok(e.tracking.some((t) => t.token === 'tok1' && t.patch.balance === 55000));
    assert.ok(e.audits.some((a) => a[1] === 'contract'));
  });
  it('a double tap applies once: one ledger row, the job changed once', async () => {
    const e = env(PRES, withPending());
    await Promise.all([e.UI.applyRevision({ id: 'so1', pendingRevision: pending() }), e.UI.applyRevision({ id: 'so1', pendingRevision: pending() })]);
    await e.UI.applyRevision({ id: 'so1', pendingRevision: pending() });
    assert.equal(e.ledger().length, 1);
    assert.equal(e.pj().timeline.length, 1); assert.equal(e.so().contractRev, 1); assert.equal(e.so().revisions.length, 1);
  });
  it('a non-president cannot approve a price approval (pending_approval): nothing written', async () => {
    const e = env(FIN, withPending({ status: 'pending_approval', toAmount: 90000, delta: -10000 }));
    await e.UI.applyRevision({ id: 'so1', pendingRevision: pending({ status: 'pending_approval' }) });
    assert.equal(e.ledger().length, 0); assert.ok(e.so().pendingRevision); assert.equal(e.so().contractRev, undefined);
    const host = { innerHTML: '', querySelectorAll: () => [] };
    await e.UI.renderDecisionBlock(host);
    assert.equal(host.innerHTML, '', 'the stand-in is not even shown it');
  });
  it('Finance stands in for a no-approval change (not her own), and Neil is told; the block lists it with a Confirm button', async () => {
    const e = env(FIN, withPending());
    const host = { innerHTML: '', querySelectorAll: () => [] };
    await e.UI.renderDecisionBlock(host);
    assert.match(host.innerHTML, /Confirm/); assert.doesNotMatch(host.innerHTML, /Approve</);
    await e.UI.applyRevision({ id: 'so1', pendingRevision: pending() });
    assert.equal(e.ledger().length, 1); assert.equal(e.so().revisions[0].onBehalf, true);
    assert.ok(e.notifs.some((n) => n.kind === 'owner' && /confirmed by/.test(n.title)));
  });
  it('Finance cannot decide a change she requested herself', async () => {
    const e = env(FIN, withPending({ requestedBy: 'u-fin' }));
    await e.UI.applyRevision({ id: 'so1', pendingRevision: pending({ requestedBy: 'u-fin' }) });
    assert.equal(e.ledger().length, 0);
  });
  it('the President sees a price approval with an Approve button and the reason', async () => {
    const e = env(PRES, withPending({ status: 'pending_approval', toAmount: 90000, delta: -10000, gate: { approval: 'president', reason: 'below_approved_and_standard' } }));
    const host = { innerHTML: '', querySelectorAll: () => [] };
    await e.UI.renderDecisionBlock(host);
    assert.match(host.innerHTML, /Approve/); assert.match(host.innerHTML, /below the last approved price/);
  });
  it('a decrease applies as a credit receivable row (|difference|) and the order shows client credit when below collected', async () => {
    const e = env(PRES, withPending({ status: 'pending_approval', toAmount: 50000, delta: -50000 }));
    await e.UI.applyRevision({ id: 'so1', pendingRevision: pending({ status: 'pending_approval' }) });
    assert.equal(e.ledger()[0][1].amount, 50000); assert.equal(e.pj().clientCredit, 15000); assert.equal(e.pj().arBalance, 0);
  });
  it('a quote revision with the same total (delta 0) posts no ledger row and updates job and order together', async () => {
    const q2 = quote({ total: 100000, items: [{ name: 'Table', qty: 3 }], rootQuoteId: 'q1', approvalStatus: 'approved' });
    const e = env(PRES, { so: { pendingRevision: pending({ kind: 'quote_revision', toAmount: 100000, delta: 0, quoteId: 'q2', quoteColl: 'bk_quotes', quoteNumber: 'BK-1-R2' }) }, seed: { bk_quotes: { q1: quote(), q2 } } });
    await e.UI.applyRevision({ id: 'so1', pendingRevision: pending() });
    assert.equal(e.ledger().length, 0); assert.equal(e.so().contractRev, 1); assert.equal(e.pj().joRev, 1);
    same(e.pj().items, q2.items); assert.equal(e.db.store.bk_quotes.get('q2').status, 'won'); assert.equal(e.so().quoteIdOriginal, 'q1');
  });
});

describe('4. send back (§7.3)', () => {
  it('the President sends back with a reason: status rejected, decision rejected, reason stored, proposer told, no money', async () => {
    const e = env(PRES, { ...withPending(), promptAnswer: 'price is too low' });
    assert.equal(await e.UI.sendBack({ id: 'so1', pendingRevision: pending() }), true);
    const pr = e.so().pendingRevision;
    assert.equal(pr.status, 'rejected'); assert.equal(pr.decision, 'rejected'); assert.equal(pr.reason, 'price is too low'); assert.equal(pr.changeReason, 'Client added a shelf');
    assert.equal(e.ledger().length, 0); assert.equal(e.so().contractAmount, 100000);
    assert.ok(e.notifs.some((n) => n.kind === 'send' && n.to === 'u-sales' && /price is too low/.test(n.body)));
  });
  it('a viewer who cannot decide cannot send back (Finance on a President-only request; Sales)', async () => {
    const e = env(FIN, withPending({ status: 'pending_approval' }));
    assert.equal(await e.UI.sendBack({ id: 'so1', pendingRevision: pending({ status: 'pending_approval' }) }), false);
    assert.equal(e.so().pendingRevision.status, 'pending_approval');
    const e2 = env(SALES, withPending());
    assert.equal(await e2.UI.sendBack({ id: 'so1', pendingRevision: pending() }), false);
  });
});

describe('5. record refund (§7.7) and the adjustments line', () => {
  it('Finance refunds client credit: one -RF expense row, amountCollected falls, credit zero; more than the credit is refused', async () => {
    const e = env(FIN, { so: { contractRev: 1, contractAmount: 50000 }, pj: { contractAmount: 50000, clientCredit: 15000, arBalance: 0 } });
    await e.UI.openRefundSheet({ id: 'so1' });
    const p = e.lastPage();
    p.$('rf-amount').value = '20000';
    await p.$('rf-go').click();
    assert.equal(e.ledger().length, 0);
    p.$('rf-amount').value = '15000';
    await p.$('rf-go').click();
    assert.equal(e.ledger().length, 1); assert.equal(e.ledger()[0][0], 'SO-so1-R1-RF');
    assert.equal(e.pj().amountCollected, 50000); assert.equal(e.pj().clientCredit, 0);
  });
  it('Sales cannot record a refund', async () => {
    const e = env(SALES, { so: { contractRev: 1, contractAmount: 50000 }, pj: { contractAmount: 50000, clientCredit: 15000, arBalance: 0 } });
    await e.UI.openRefundSheet({ id: 'so1' });
    assert.equal(e.pages.length, 0);
  });
  it('adjustmentsHtml lists each revision as "SO-0012 R1: from → to" with no "Rev." and escapes names', () => {
    const e = env(PRES);
    const h = e.UI.adjustmentsHtml(order({ revisions: [{ revNo: 1, fromAmount: 100000, toAmount: 120000, decidedByName: '<b>Neil</b>', decidedAt: '2026-11-19T01:00:00.000Z' }] }));
    assert.match(h, /SO-0012 R1/); assert.doesNotMatch(h, /Rev\.|<b>/);
    assert.equal(e.UI.adjustmentsHtml(order()), '');
  });
});

describe('Choice A offers only NEWER approved revisions (§7.2)', () => {
  it('an older approved revision of the chain is never offered; a newer one is', async () => {
    const at = (s) => ({ seconds: s });
    const e = env(SALES, { seed: { bk_quotes: {
      q0: quote({ quoteNumber: 'BK-0', total: 90000, createdAt: at(100) }),
      q1: quote({ quoteNumber: 'BK-1', createdAt: at(200) }),
      q3: quote({ quoteNumber: 'BK-1-R3', total: 118000, createdAt: at(300) }) } } });
    await e.UI.openReviseSheet({ id: 'so1' });
    const offered = e.lastPage().radios.filter((r) => r.name === 'rv-quote').map((r) => r.value);
    assert.deepEqual(offered, ['q3']);
  });
});
