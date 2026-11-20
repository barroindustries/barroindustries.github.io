// tests/flow-docs.test.mjs — Phase 4 turnover + close: J8 (the signed acceptance and a cleared punch list before "Completed") and J9 (a job closes when
// it is completed AND the balance is zero), specs/SALES-FLOW-SPEC-2026-11-19.md §5.4, §7.6 item 6, §13.2 Phase 4, owner ruling SF19.
//
//   1. WIRING     sw.js precaches js/flow-core.js and js/screens/flow-docs.js on their own lines; neither is an index.html script (lazy; the app-kit
//                 is Phase 8); both legacy "balance reached 0 -> stage paid" lines are guarded to legacy jobs; the three close hooks are guarded and last.
//   2. J8 GUARD   js/screens/production.js advanceProjectStage runs for real in the shared Sales harness: a flow-2 job cannot enter "completed" without the
//                 acceptance and the cleared punch list (a screen with a button to each is shown); a legacy job is unchanged.
//   3. J9 CLOSE   completed + zero balance closes straight away; completed with a balance stays open until the confirming payment closes it; a contract
//                 decrease closes it; a client credit keeps it open until the refund; the old auto-close no longer fires for a flow-2 job; Neil is told once.
//   4. SCREENS    the acceptance sheet and the punch-list writers write the shapes js/forms-core.js reads, and those forms then print them filled.
//
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PRES, SALES, FIN, PROD, makeBaseEnv, read, same, sliceOf } from './fixtures/sales-flow-harness.mjs';
import { setupForms, fixtures } from './fixtures/forms-env.mjs';

const SW = read('sw.js'), HTML = read('index.html'), PRODSRC = read('js/screens/production.js'), DEPT = read('js/departments.js');
const PCUI = read('js/payment-claims-ui.js'), CUI = read('js/contract-ui.js'), DOCS = read('js/screens/flow-docs.js');
const require = createRequire(import.meta.url);

describe('1. wiring', () => {
  const precache = (() => { const m = SW.match(/const PRECACHE = \[([\s\S]*?)\n\];/); return [...m[1].matchAll(/^\s*'([^']+)',?\s*(?:\/\/.*)?$/gm)].map((x) => x[1]); })();
  it('sw.js precaches flow-core and flow-docs on their own lines, next to the other flow lines', () => {
    const at = ['/js/payment-claims-ui.js', '/js/flow-core.js', '/js/screens/flow-docs.js'].map((f) => precache.indexOf(f));
    assert.ok(at.every((i) => i >= 0), String(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    for (const f of ['/js/flow-core.js', '/js/screens/flow-docs.js']) assert.ok(SW.includes(`\n  '${f}',\n`), f);
  });
  it('both files are LAZY: not an index.html script and not in the app kit (the kit is Phase 8); flow-docs loads its own core', () => {
    assert.doesNotMatch(HTML, /js\/flow-core\.js/);
    assert.doesNotMatch(HTML, /js\/screens\/flow-docs\.js/);
    assert.match(DOCS, /ensureScript\('js\/flow-core\.js'\)/);
  });
  it('both old "balance is zero -> stage paid" writes are for legacy jobs only', () => {
    assert.match(PRODSRC, /if\(newAR<=0 && !\(Number\(p\.flowVersion\)>=2\)\) update\.stage='paid';/);
    assert.match(DEPT, /if \(newAR<=0 && !\(Number\(p\.flowVersion\)>=2\)\) fields\.stage='paid';/);
    assert.equal((PRODSRC.match(/update\.stage='paid'/g) || []).length, 1);
    assert.equal((DEPT.match(/fields\.stage='paid'/g) || []).length, 1);
  });
  it('the close hooks are guarded and come last: after a confirmed payment, after an applied revision, after a refund', () => {
    assert.match(PCUI, /closeIfSettled\(o\.projectId, who\)[\s\S]{0,40}\n    invalidate\(\);\n  \}/);
    assert.match(CUI, /closeIfSettled\(order\.projectId, who\)[\s\S]{0,40}\n    invalidate\(\);\n  \}/);
    assert.match(CUI, /closeIfSettled\(project\.id, who\)/);
    assert.match(PCUI, /await step\(async function \(\) \{ if \(o\.projectId\)/);
  });
  it('flow-docs: no peso sign, no notification to Production, every dynamic value in an HTML string is escaped', () => {
    assert.doesNotMatch(DOCS.replace(/\/\/[^\n]*/g, ''), /₱|fmtN2|money\(/);
    assert.doesNotMatch(DOCS, /sendToDept\('Production'/);
    assert.doesNotMatch(DOCS, /toast\([^)]*<[a-z]/);
  });
  it('the job detail has a flow-2-only host and a lazy guarded call; a flow-2 job is never offered "Advance → Paid / Closed"', () => {
    assert.match(PRODSRC, /\$\{Number\(p\.flowVersion\)>=2 && !isBsOnlyU\?'<div id="jpd-flowdocs"><\/div>':''\}/);
    assert.match(PRODSRC, /window\.ensureScript\('js\/screens\/flow-docs\.js'\)\.then\(\(\)=>\{[\s\S]{0,400}renderJobDocs\(_docsHost, pj, _paintDocs\)/);
    assert.match(PRODSRC, /\(Number\(p\.flowVersion\)>=2 && p\.stage==='completed'\)\) \? null/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
const STAGES = sliceOf(PRODSRC, 'const PROD_STAGES = window.PROD_STAGES = [', '// ── panelLive(panel)');
const JOBSTAGES = sliceOf(PRODSRC, 'const JOB_STAGES = [', '// COMPANY-AND-CALENDAR-SPEC-2026-08-12 §1.4');
const ADVANCE = sliceOf(PRODSRC, '// A fully prepaid job closes by itself once everything on it has been delivered', 'async function openProjectBillingModal(p){');
const SYNC = sliceOf(PRODSRC, 'async function syncJobFromProdStage(projectId, prodStageId) {', "// Consume a production order's materials");

const acc = (o = {}) => ({ url: 'https://x.test/acc.pdf', name: 'acc.pdf', signedBy: 'Maria Cruz', date: '2026-11-19', by: 'u-prod', byName: 'Rene', at: '2026-11-19T02:00:00.000Z', ...o });
const punch = (o = {}) => ({ items: [{ text: 'Re-seal the sink', location: 'Wash area', done: true }], clearedAt: '2026-11-19T03:00:00.000Z', clearedBy: 'Rene', ...o });
const job = (o = {}) => ({ projectNo: 'JP-2611-004', joNumber: 'JO-0012', clientName: 'Acme Foods', clientId: 'c1', stage: 'delivered', flowVersion: 2, contractAmount: 100000, amountCollected: 100000, arBalance: 0, salesOrderId: 'so1', trackingToken: 'tok1', documents: [], timeline: [], payments: [], ...o });
const readyJob = (o = {}) => job({ acceptance: acc(), punchList: punch(), ...o });
const order = (o = {}) => ({ projectId: 'prj1', quoteId: 'q1', quoteNumber: 'BK-1', soNumber: 'SO-0012', clientId: 'c1', clientName: 'Acme Foods', company: 'BK', contractAmount: 100000, paymentReceived: 65000, recordedAmount: 65000, vatTreatment: 'inclusive', status: 'recorded', flowVersion: 2, createdBy: 'u-sales', createdByName: 'Uriel', ...o });
const claim = (o = {}) => ({ kind: 'balance', orderId: 'so1', projectId: 'prj1', quoteNumber: 'BK-1', clientId: 'c1', clientName: 'Acme Foods', company: 'BK', paymentReceived: 35000, paymentMethod: 'GCash', vatTreatment: 'inclusive', orRef: 'REF-9', paymentDate: '2026-11-19', receiptUrl: 'https://r.example/p.pdf', receiptName: 'p.pdf', status: 'pending', paymentConfirm: { requestedAt: '2026-11-19T01:00:00.000Z', requestedBy: 'u-sales', requestedByName: 'Uriel', decision: null, resubmits: 0 }, createdBy: 'u-sales', createdByName: 'Uriel', createdAt: { seconds: 10, toDate: () => new Date(10000) }, ...o });
const pending = (o = {}) => ({ revNo: 1, kind: 'manual', fromAmount: 100000, toAmount: 65000, delta: -35000, changeReason: 'Client dropped a shelf', quoteId: null, quoteColl: null, quoteNumber: null, changeOrderId: null, gate: { approval: 'president', reason: 'below_approved_and_standard', lastApproved: 100000, stdTotal: null, collected: 65000 }, status: 'pending_approval', requestedAt: '2026-11-19T01:00:00.000Z', requestedBy: 'u-sales', requestedByName: 'Uriel', resubmits: 0, prevReason: '', decision: null, ...o });

function makeForms() {
  const f = { counter: 0 };
  f.nextNumber = async (s) => `${s}-${String(++f.counter).padStart(4, '0')}`;
  f.buttonHtml = (id) => `<button data-form="${id}">${id}</button>`;
  f.bind = () => {};
  return f;
}
function env(who, { pj = {}, so = {}, claims = {}, seed = {} } = {}) {
  const forms = makeForms();
  const e = makeBaseEnv(who, { seed: { sales_orders: { so1: order(so) }, job_projects: { prj1: job(pj) }, payment_claims: claims, bk_quotes: { q1: { quoteNumber: 'BK-1', total: 100000, rootQuoteId: 'q1', approvalStatus: 'approved' } }, ...seed }, forms });
  const c = e.ctx;
  c.canEditDept = (d) => who.role === 'president' || (who.depts || []).includes(d);
  c.flowForms = () => c.ensureScript('js/forms.js').then(() => c.Forms);
  c.navigateTo = () => {};
  c.nextCounterId = async () => 'JP-2611-001';
  c.renderProjectLifecycle = () => { e.rendered = (e.rendered || 0) + 1; };
  c.ensureProdHandoffFields = async () => true;
  for (const f of ['js/payment-claims-core.js', 'js/payment-claims-ui.js', 'js/price-gate-core.js', 'js/contract-core.js', 'js/contract-ui.js', 'js/flow-core.js', 'js/screens/flow-docs.js']) e.load(read(f), f);
  e.load("'use strict';\n" + STAGES + '\n' + JOBSTAGES + '\n' + ADVANCE + '\n' + SYNC, 'js/screens/production.js (slices)');
  e.pj = () => e.db.store.job_projects.get('prj1');
  e.stamp = (k) => e.pj()['stageAt.' + k];
  e.closedNotifs = () => e.notifs.filter((n) => /Job closed/.test(n.title || ''));
  return e;
}
const advance = async (e, nextId) => e.ctx.advanceProjectStage({ id: 'prj1', ...e.pj() }, nextId);

describe('2. J8 guard — no "Completed" without the signed acceptance and a cleared punch list', () => {
  it('a flow-2 job with neither: refused, the job is untouched, and a screen names both with a button to each', async () => {
    const e = env(PROD, { pj: job({ amountCollected: 65000, arBalance: 35000 }) });
    await advance(e, 'completed');
    assert.equal(e.pj().stage, 'delivered');
    assert.equal(e.db.writes('job_projects/prj1').length, 0);
    const p = e.lastPage();
    assert.ok(p && p.$('fb-acc') && p.$('fb-pl'), 'both buttons');
    assert.match(p.html, /client acceptance/); assert.match(p.html, /punch list/);
    assert.doesNotMatch(p.html, /₱/);
  });
  it('acceptance alone is not enough; a cleared punch list alone is not enough (each message names only what is missing)', async () => {
    const a = env(PROD, { pj: job({ acceptance: acc() }) });
    await advance(a, 'completed');
    assert.equal(a.pj().stage, 'delivered'); assert.ok(a.lastPage().$('fb-pl') && !a.lastPage().$('fb-acc'));
    const b = env(PROD, { pj: job({ punchList: punch() }) });
    await advance(b, 'completed');
    assert.equal(b.pj().stage, 'delivered'); assert.ok(b.lastPage().$('fb-acc') && !b.lastPage().$('fb-pl'));
  });
  it('an acceptance with no file, or an empty punch list that was never cleared, is still refused', async () => {
    const a = env(PROD, { pj: job({ acceptance: acc({ url: '' }), punchList: punch() }) });
    await advance(a, 'completed'); assert.equal(a.pj().stage, 'delivered');
    const b = env(PROD, { pj: job({ acceptance: acc(), punchList: { items: [] } }) });
    await advance(b, 'completed'); assert.equal(b.pj().stage, 'delivered');
  });
  it('the buttons open the two screens (acceptance sheet, punch-list sheet)', async () => {
    const e = env(PROD, { pj: job() });
    await advance(e, 'completed');
    const p = e.lastPage();
    const before = e.pages.length;
    await p.$('fb-acc').click(); assert.ok(e.lastPage().$('fa-save') && e.pages.length === before + 1);
    await p.$('fb-pl').click(); assert.ok(e.lastPage().$('pl-clear'));
  });
  it('with both and a zero balance: Completed AND closed in the same tap; stageAt.balance and stageAt.closed stamped; no pesos in the timeline', async () => {
    const e = env(PROD, { pj: readyJob() });
    await advance(e, 'completed');
    const p = e.pj();
    assert.equal(p.stage, 'paid');
    assert.ok(p['stageAt.balance'] && p['stageAt.closed'] && p.closedAt);
    assert.ok(p.timeline.some((t) => t.event === 'Moved to Completed') && p.timeline.some((t) => t.event === 'Closed — accepted and fully paid'));
    assert.ok(!p.timeline.some((t) => /₱/.test(t.event)));
    assert.ok(e.toastMsgs().includes('Completed — and closed, because it is fully paid'));
  });
  it('with a balance: Completed and stays OPEN (stageAt.balance stamped, no closedAt), and nobody is told it closed', async () => {
    const e = env(PROD, { pj: readyJob({ amountCollected: 65000, arBalance: 35000 }) });
    await advance(e, 'completed');
    assert.equal(e.pj().stage, 'completed');
    assert.ok(e.stamp('balance')); assert.equal(e.pj().closedAt, undefined); assert.equal(e.stamp('closed'), undefined);
    assert.equal(e.closedNotifs().length, 0);
    assert.ok(e.toastMsgs().includes('Moved to Completed'));
  });
  it('the moves this code performs stamp stageAt.<key> on a flow-2 job: turnover for Delivered, delivery for For Delivery', async () => {
    const a = env(PROD, { pj: job({ stage: 'for_delivery', amountCollected: 1, arBalance: 99999 }) });
    await advance(a, 'delivered'); assert.ok(a.stamp('turnover'));
    const b = env(PROD, { pj: job({ stage: 'in_production', amountCollected: 1, arBalance: 99999 }) });
    await advance(b, 'for_delivery'); assert.ok(b.stamp('delivery'));
  });
  it('a flow-2 job is never moved to Paid / Closed by hand, whatever its balance', async () => {
    const e = env(PROD, { pj: readyJob({ stage: 'completed', amountCollected: 65000, arBalance: 35000 }) });
    await advance(e, 'paid');
    assert.equal(e.pj().stage, 'completed');
    assert.equal(e.db.writes('job_projects/prj1').length, 0);
    assert.ok(e.toastMsgs().some((m) => /closes by itself/.test(m)));
  });
  it('a LEGACY job is unchanged: Completed with no acceptance at all, no stageAt, and Paid by hand still works', async () => {
    const e = env(PROD, { pj: { flowVersion: undefined, amountCollected: 65000, arBalance: 35000 } });
    await advance(e, 'completed');
    assert.equal(e.pj().stage, 'completed');
    assert.ok(!Object.keys(e.pj()).some((k) => k.startsWith('stageAt')));
    await advance(e, 'paid');
    assert.equal(e.pj().stage, 'paid');
    assert.equal(e.pages.length, 0);
  });
});

describe('3. J9 close — whichever write makes it true', () => {
  const tapConfirm = async (e, id = 'cl1') => { await e.ctx.PaymentClaimsUI.openConfirmSheet({ id }); const p = e.lastPage(); await p.$('pcc-confirm').click(); return p; };
  it('completed with a balance, then the confirming payment: the job closes right after the post, and Neil is told once', async () => {
    const e = env(PRES, { pj: readyJob({ stage: 'completed', amountCollected: 65000, arBalance: 35000 }), claims: { cl1: claim() } });
    await tapConfirm(e);
    assert.equal(e.pj().amountCollected, 100000); assert.equal(e.pj().arBalance, 0);
    assert.equal(e.pj().stage, 'paid'); assert.ok(e.pj().closedAt && e.stamp('closed'));
    const n = e.closedNotifs();
    assert.equal(n.length, 1); assert.equal(n[0].kind, 'owner'); assert.equal(n[0].title, '✅ Job closed — JP-2611-004 · Acme Foods'); assert.equal(n[0].dedupKey, 'jobclosed-prj1');
    assert.doesNotMatch(JSON.stringify(n[0]), /₱/);
    assert.ok(!e.notifs.some((x) => x.dept === 'Production'));
  });
  it('a part payment that leaves a balance does not close it', async () => {
    const e = env(PRES, { pj: readyJob({ stage: 'completed', amountCollected: 65000, arBalance: 35000 }), claims: { cl1: claim({ paymentReceived: 10000 }) } });
    await tapConfirm(e);
    assert.equal(e.pj().stage, 'completed'); assert.equal(e.closedNotifs().length, 0);
  });
  it('the final payment on a job that is NOT completed yet does not close it (it waits for the acceptance)', async () => {
    const e = env(PRES, { pj: readyJob({ stage: 'delivered', amountCollected: 65000, arBalance: 35000 }), claims: { cl1: claim() } });
    await tapConfirm(e);
    assert.equal(e.pj().arBalance, 0); assert.equal(e.pj().stage, 'delivered'); assert.equal(e.closedNotifs().length, 0);
    await advance(e, 'completed');
    assert.equal(e.pj().stage, 'paid', 'then Completed closes it straight away');
  });
  it('a failing close never undoes or hides the confirmed payment', async () => {
    const e = env(PRES, { pj: readyJob({ stage: 'completed', amountCollected: 65000, arBalance: 35000 }), claims: { cl1: claim() } });
    e.db.runTransaction = async () => { throw new Error('contention'); };
    await tapConfirm(e);
    assert.equal(e.db.store.payment_claims.get('cl1').status, 'recorded');
    assert.equal(e.pj().arBalance, 0); assert.equal(e.pj().stage, 'completed');
  });
  it('a contract decrease that settles a completed job closes it (spec §7.6 item 6)', async () => {
    const e = env(PRES, { pj: readyJob({ stage: 'completed', amountCollected: 65000, arBalance: 35000 }), so: { pendingRevision: pending() } });
    await e.ctx.ContractUI.applyRevision({ id: 'so1', pendingRevision: pending() });
    assert.equal(e.pj().contractAmount, 65000); assert.equal(e.pj().arBalance, 0);
    assert.equal(e.pj().stage, 'paid'); assert.equal(e.closedNotifs().length, 1);
  });
  it('a decrease below what was collected leaves client credit, so the job stays open until the refund; the refund then closes it', async () => {
    const e = env(FIN, { pj: readyJob({ stage: 'completed', amountCollected: 100000, arBalance: 0 }), so: { pendingRevision: pending({ toAmount: 85000, delta: -15000, gate: { approval: 'none', reason: '', lastApproved: 100000, stdTotal: null, collected: 100000 }, status: 'pending_confirm' }) } });
    await e.ctx.ContractUI.applyRevision({ id: 'so1', pendingRevision: pending({ toAmount: 85000, delta: -15000, gate: { approval: 'none', reason: '', lastApproved: 100000, stdTotal: null, collected: 100000 }, status: 'pending_confirm' }) });
    assert.equal(e.pj().clientCredit, 15000, e.toastMsgs().join('|'));
    assert.equal(e.pj().stage, 'completed'); assert.equal(e.closedNotifs().length, 0);
    await e.ctx.ContractUI.openRefundSheet({ id: 'so1' });
    const p = e.lastPage(); p.$('rf-amount').value = '15000';
    await p.$('rf-go').click();
    assert.equal(e.pj().clientCredit, 0, e.toastMsgs().join('|'));
    assert.equal(e.pj().stage, 'paid'); assert.equal(e.closedNotifs().length, 1);
  });
  it('closeIfSettled closes ONCE: a second call (a race, a retry) changes nothing and tells nobody', async () => {
    const e = env(PRES, { pj: readyJob({ stage: 'completed' }) });
    assert.equal(await e.ctx.FlowDocs.closeIfSettled('prj1', 'Neil'), true);
    const writes = e.db.writes('job_projects/prj1').length;
    assert.equal(await e.ctx.FlowDocs.closeIfSettled('prj1', 'Neil'), false);
    assert.equal(e.db.writes('job_projects/prj1').length, writes); assert.equal(e.closedNotifs().length, 1);
  });
  it('closeIfSettled leaves a LEGACY job, a missing job and a job with a balance exactly as they were, and never throws', async () => {
    const legacy = env(PRES, { pj: { flowVersion: undefined, stage: 'completed' } });
    assert.equal(await legacy.ctx.FlowDocs.closeIfSettled('prj1', 'x'), false); assert.equal(legacy.pj().stage, 'completed');
    const owing = env(PRES, { pj: readyJob({ stage: 'completed', arBalance: 500 }) });
    assert.equal(await owing.ctx.FlowDocs.closeIfSettled('prj1', 'x'), false); assert.equal(owing.pj().stage, 'completed');
    assert.equal(await owing.ctx.FlowDocs.closeIfSettled('nope', 'x'), false);
    assert.equal(await owing.ctx.FlowDocs.closeIfSettled('', 'x'), false);
  });
  it('a failed notification never undoes the close', async () => {
    const e = env(PRES, { pj: readyJob({ stage: 'completed' }) });
    e.ctx.Notifs.sendToOwner = async () => { throw new Error('push down'); };
    assert.equal(await e.ctx.FlowDocs.closeIfSettled('prj1', 'x'), true); assert.equal(e.pj().stage, 'paid');
  });
  it('the close writes no money key', async () => {
    const e = env(PRES, { pj: readyJob({ stage: 'completed' }) });
    await e.ctx.FlowDocs.closeIfSettled('prj1', 'x');
    const patch = e.db.writes('job_projects/prj1').pop().patch;
    for (const k of ['amountCollected', 'arBalance', 'payments', 'contractAmount', 'clientCredit', 'refunds', 'invoices']) assert.ok(!(k in patch), k);
  });
  it('the old auto-close no longer fires for a flow-2 job: a fully prepaid job at Delivered stays Delivered (helper, job-level Advance, and the work-order sync)', async () => {
    const a = env(PROD, { pj: job({ stage: 'delivered' }) });
    assert.equal(await a.ctx.closePrepaidJobIfDelivered('prj1', 'Rene'), false); assert.equal(a.pj().stage, 'delivered');
    const b = env(PROD, { pj: job({ stage: 'for_delivery' }), seed: { production_orders: { w1: { projectId: 'prj1', stage: 'delivered', orderNo: 'WO-1' } } } });
    await advance(b, 'delivered');
    assert.equal(b.pj().stage, 'delivered'); assert.equal(b.closedNotifs().length, 0); assert.ok(b.stamp('turnover'));
    const c = env(PROD, { pj: job({ stage: 'in_production' }), seed: { production_orders: { w1: { projectId: 'prj1', stage: 'delivered', orderNo: 'WO-1' } } } });
    await c.ctx.syncJobFromProdStage('prj1', 'delivered');
    assert.equal(c.pj().stage, 'delivered'); assert.ok(c.stamp('turnover'));
  });
  it('a legacy fully prepaid job still closes at delivery (unchanged)', async () => {
    const e = env(PROD, { pj: { flowVersion: undefined, stage: 'for_delivery' }, seed: { production_orders: { w1: { projectId: 'prj1', stage: 'delivered', orderNo: 'WO-1' } } } });
    await advance(e, 'delivered');
    assert.equal(e.pj().stage, 'paid');
  });
});

describe('4. the screens (Client acceptance, Punch list)', () => {
  it('saves the acceptance in the shape forms-core reads: { url, name, signedBy, date, by, byName, at }, one timeline line without pesos', async () => {
    const e = env(PROD);
    await e.ctx.FlowDocs.openAcceptance({ id: 'prj1', ...e.pj() });
    const p = e.lastPage();
    assert.doesNotMatch(p.html, /₱/);
    e.uploads['fa-upload'].cb({ url: 'https://x.test/signed.pdf', name: 'signed.pdf' });
    p.$('fa-signer').value = 'Maria Cruz'; p.$('fa-date').value = '2026-11-19';
    await p.$('fa-save').click();
    const a = e.pj().acceptance;
    same(Object.keys(a).sort(), ['at', 'by', 'byName', 'date', 'name', 'signedBy', 'url']);
    assert.equal(a.url, 'https://x.test/signed.pdf'); assert.equal(a.signedBy, 'Maria Cruz'); assert.equal(a.date, '2026-11-19'); assert.equal(a.by, 'u-prod'); assert.equal(a.byName, 'Rene');
    assert.ok(e.pj().timeline.some((t) => /Client acceptance attached/.test(t.event) && !/₱/.test(t.event)));
    assert.equal(e.uploads['fa-upload'].opts.dept, 'Production');
  });
  it('refuses without the file, the signer or the date (nothing written)', async () => {
    const e = env(PROD);
    for (const bad of [{ signedBy: 'M', date: '2026-11-19' }, { url: 'u', date: '2026-11-19' }, { url: 'u', signedBy: 'M' }]) {
      const r = await e.ctx.FlowDocs.saveAcceptance('prj1', bad);
      assert.equal(r.ok, false);
    }
    assert.equal(e.pj().acceptance, undefined); assert.equal(e.db.writes('job_projects/prj1').length, 0);
  });
  it('only Production (and the President) opens them; a legacy job and a closed job are refused', async () => {
    const s = env(SALES);
    await s.ctx.FlowDocs.openAcceptance({ id: 'prj1', ...s.pj() }); await s.ctx.FlowDocs.openPunchList({ id: 'prj1', ...s.pj() });
    assert.equal(s.pages.length, 0);
    const l = env(PROD, { pj: { flowVersion: undefined } });
    await l.ctx.FlowDocs.openAcceptance({ id: 'prj1', ...l.pj() }); assert.equal(l.pages.length, 0);
    assert.equal((await l.ctx.FlowDocs.saveAcceptance('prj1', { url: 'u', signedBy: 'M', date: 'd' })).code, 'legacy');
    const c = env(PROD, { pj: { stage: 'paid' } });
    assert.equal((await c.ctx.FlowDocs.savePunchList('prj1', [{ text: 'a' }])).code, 'closed');
  });
  it('punch list items are { text, location, raisedDate, done, doneDate, by }; blank rows are dropped; a ticked item gets a done date', async () => {
    const e = env(PROD);
    const r = await e.ctx.FlowDocs.savePunchList('prj1', [{ text: ' Scratch on sink ', location: 'Wash area' }, { text: '   ' }, { text: 'Loose bracket', done: true }]);
    assert.equal(r.ok, true);
    const items = e.pj().punchList.items;
    assert.equal(items.length, 2);
    same(items[0], { text: 'Scratch on sink', location: 'Wash area', raisedDate: '2026-11-19', done: false, by: 'Rene' });
    same(items[1], { text: 'Loose bracket', location: '', raisedDate: '2026-11-19', done: true, by: 'Rene', doneDate: '2026-11-19' });
    assert.equal(e.pj().punchList.clearedAt, undefined);
    assert.ok(!(e.pj().timeline.some((t) => /₱/.test(t.event))));
  });
  it('Mark all cleared ticks every item and writes clearedAt / clearedBy; an EMPTY list can be cleared too — and that is what lets the job complete', async () => {
    const e = env(PROD, { pj: { acceptance: acc() } });
    await e.ctx.FlowDocs.openPunchList({ id: 'prj1', ...e.pj() });
    const p = e.lastPage();
    await p.$('pl-clear').click();
    assert.ok(e.pj().punchList.clearedAt && e.pj().punchList.clearedBy === 'Rene'); assert.deepEqual(e.pj().punchList.items, []);
    await advance(e, 'completed');
    assert.equal(e.pj().stage, 'paid');
    const f = env(PROD, { pj: { punchList: { items: [{ text: 'a', done: false }] } } });
    await f.ctx.FlowDocs.savePunchList('prj1', [{ text: 'a', done: false }, { text: 'b', done: false }], { clear: true });
    assert.ok(f.pj().punchList.items.every((x) => x.done && x.doneDate));
  });
  it('editing a cleared list takes the cleared mark off again (an item added afterwards must be cleared too)', async () => {
    const e = env(PROD, { pj: { acceptance: acc(), punchList: punch() } });
    await e.ctx.FlowDocs.savePunchList('prj1', [{ text: 'Re-seal the sink', done: true }, { text: 'New item' }]);
    assert.equal(e.pj().punchList.clearedAt, undefined);
    await advance(e, 'completed');
    assert.equal(e.pj().stage, 'delivered', 'refused again');
  });
  it('the job-detail block shows both statuses with a button each for Production, and nothing for a legacy job or a stage it does not apply to', async () => {
    const e = env(PROD);
    const host = { innerHTML: '', querySelector: () => null };
    await e.ctx.FlowDocs.renderJobDocs(host, { id: 'prj1', ...e.pj() }, () => {});
    assert.match(host.innerHTML, /Client acceptance/); assert.match(host.innerHTML, /Not attached yet/); assert.match(host.innerHTML, /fd-acc/); assert.match(host.innerHTML, /fd-pl/);
    assert.doesNotMatch(host.innerHTML, /₱/);
    for (const p of [{ ...e.pj(), flowVersion: undefined }, { ...e.pj(), stage: 'in_design' }]) { const h = { innerHTML: '' }; await e.ctx.FlowDocs.renderJobDocs(h, { id: 'prj1', ...p }, () => {}); assert.equal(h.innerHTML, ''); }
    const s = env(SALES); const h2 = { innerHTML: '', querySelector: () => null };
    await s.ctx.FlowDocs.renderJobDocs(h2, { id: 'prj1', ...s.pj() }, () => {});
    assert.doesNotMatch(h2.innerHTML, /fd-acc/);
  });
  it('the forms then print what the screens wrote: the punch list lists the items and the acceptance form carries the signer, date and punch position', async () => {
    const e = env(PROD);
    await e.ctx.FlowDocs.saveAcceptance('prj1', { url: 'https://x.test/s.pdf', name: 's.pdf', signedBy: 'Maria Cruz', date: '2026-12-18' });
    await e.ctx.FlowDocs.savePunchList('prj1', [{ text: 'Scratch on sink front', location: 'Wash area' }, { text: 'Loose shelf bracket', done: true }], { clear: true });
    const stored = JSON.parse(JSON.stringify(e.pj()));
    const FC = setupForms();
    require('../js/forms-set-2.js');
    require('../js/qrcode.js');
    const { project: fp, order: fo, client } = fixtures();
    const proj = Object.assign(JSON.parse(JSON.stringify(fp)), { acceptance: stored.acceptance, punchList: stored.punchList });
    const viewer = { uid: 'u-prod', role: 'employee', depts: ['Production'], isPresident: false };
    const html = (id) => { const prep = FC.prepare(id, { today: '2026-12-20', client, viewer, workOrders: [], drawings: [], project: proj, order: JSON.parse(JSON.stringify(fo)) }); assert.ok(prep.ok, id + ': ' + prep.error); return FC.compose(prep, FC.renderSections(prep)).bodyHtml.replace(/<[^>]*>/g, ' '); };
    const pl = html('punch_list'); assert.match(pl, /Scratch on sink front/); assert.match(pl, /Loose shelf bracket/);
    const ca = html('client_acceptance'); assert.match(ca, /Maria Cruz/); assert.match(ca, /All 2 punch-list item\(s\) have been cleared/);
  });
});
