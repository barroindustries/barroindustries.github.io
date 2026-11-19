// tests/sales-flow-production.test.mjs — WP4 of specs/SALES-QUICK-FIXES-SPEC-2026-11-19.md (§5.6 P1-P7) and owner ruling SF19.
//
// Runs the REAL code of js/screens/production.js that this batch touches, inside the shared fake world
// (tests/fixtures/sales-flow-harness.mjs): createJobProject (P1), jobDesignApproved (P2), the stage tables, and — for SF19 —
// closePrepaidJobIfDelivered, advanceProjectStage and syncJobFromProdStage. The Incoming / Job Orders filters, the job
// detail buttons and the Drawings card (P3-P7) live inside large render functions, so those are pinned textually.
//
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PRES, SALES, makeBaseEnv, read, same, sliceOf } from './fixtures/sales-flow-harness.mjs';

const PROD = read('js/screens/production.js');
const STAGES = sliceOf(PROD, 'const PROD_STAGES = window.PROD_STAGES = [', '// ── panelLive(panel)');
const JOBSTAGES = sliceOf(PROD, 'const JOB_STAGES = [', '// COMPANY-AND-CALENDAR-SPEC-2026-08-12 §1.4');
const APPROVAL = sliceOf(PROD, 'function designApprovalOf(p){', '// The gate transferOrderToProduction consults.') ;
const GATE = sliceOf(PROD, 'window.jobDesignApproved = function(p, so){', 'async function setDesignApproval');
const CREATE = sliceOf(PROD, 'async function createJobProject(d){', 'window.renderProjectLifecycle = async function(){');
const ADVANCE = sliceOf(PROD, '// A fully prepaid job closes by itself once everything on it has been delivered', 'async function openProjectBillingModal(p){');
const SYNC = sliceOf(PROD, 'async function syncJobFromProdStage(projectId, prodStageId) {', "// Consume a production order's materials");

function makeEnv(who, opts) {
  const env = makeBaseEnv(who, opts);
  const ctx = env.ctx;
  ctx.nextCounterId = async () => 'JP-2611-001';
  ctx.renderProjectLifecycle = () => { env.rendered = (env.rendered || 0) + 1; };
  ctx.ensureProdHandoffFields = async () => true;
  ctx.fmt = ctx.fmtN2;
  env.load("'use strict';\n" + STAGES + '\n' + JOBSTAGES + '\n' + APPROVAL + '\n' + GATE + '\n' + CREATE + '\n' + ADVANCE + '\n' + SYNC, 'js/screens/production.js (WP4 slices)');
  return env;
}
const job = (over = {}) => ({ projectNo: 'JP-2611-004', clientName: 'Mang Inasal', stage: 'for_delivery', contractAmount: 100000, amountCollected: 100000, arBalance: 0, trackingToken: 'tok1', documents: [], timeline: [], payments: [], ...over });
const order = (over = {}) => ({ projectId: 'prj1', stage: 'delivered', orderNo: 'WO-1', ...over });

describe('P1 createJobProject passes flowVersion through', () => {
  const d = { id: 'q1', qno: 'BK-1', client: 'Acme', clientId: '', total: 100000, co: 'BK', dpPercent: 50, items: [{ n: 1 }], targetDate: '', priority: '', notes: '' };
  it('a flow-2 job is stamped flowVersion 2 (and starts at "won")', async () => {
    const env = makeEnv(SALES, { seed: {} });
    const res = await env.ctx.createJobProject({ ...d, flowVersion: 2 });
    const p = env.db.store.job_projects.get(res.id);
    assert.equal(p.flowVersion, 2); assert.equal(p.stage, 'won');
    assert.equal(p.contractAmount, 100000); assert.equal(p.amountCollected, 0); assert.equal(p.arBalance, 100000);
  });
  it('a job created without it carries no flowVersion at all (legacy jobs are unchanged)', async () => {
    const env = makeEnv(SALES, { seed: {} });
    const res = await env.ctx.createJobProject({ ...d });
    assert.ok(!('flowVersion' in env.db.store.job_projects.get(res.id)));
  });
  it('the same-quote guard still refuses a second job for the same quote', async () => {
    const env = makeEnv(SALES, { seed: { job_projects: { p0: { quoteId: 'q1' } } } });
    await assert.rejects(() => env.ctx.createJobProject({ ...d, flowVersion: 2 }), (e) => e.code === 'already-converted' && e.existingProjectId === 'p0');
  });
});

describe('P2 jobDesignApproved: a drawing Sales attached is the sign-off', () => {
  const approved = (p, so) => makeEnv(SALES, { seed: {} }).ctx.window.jobDesignApproved(p, so);
  const dwg = { url: 'https://d.example/x.pdf' };
  it('noDrawingsNeeded on the order (as before)', () => assert.equal(approved({}, { noDrawingsNeeded: true }), true));
  it('a hand-off drawing on the ORDER, or on the JOB', () => {
    assert.equal(approved({}, { handoffDrawing: dwg }), true);
    assert.equal(approved({ handoffDrawing: dwg }, null), true);
    assert.equal(approved({ handoffDrawing: dwg }, { id: 'o1' }), true);
  });
  it('a drawing with no url does not count', () => {
    assert.equal(approved({ handoffDrawing: { url: '' } }, { handoffDrawing: {} }), false);
    assert.equal(approved({ handoffDrawing: {} }, null), false);
  });
  it('the old way still works: Design → Sales approval', () => {
    assert.equal(approved({ designApproval: { status: 'approved' } }, null), true);
    assert.equal(approved({ designApproval: { status: 'pending' } }, null), false);
    assert.equal(approved({ designApproval: { status: 'changes' } }, { id: 'o1' }), false);
    assert.equal(approved({}, null), false);
    assert.equal(approved(null, null), false);
  });
});

describe('P3-P7 (pinned in the source: these live inside the large render functions)', () => {
  it('P3 Incoming jobs: a flow-2 job still at "won" is not listed — it reaches Production only once generated', () => {
    assert.match(PROD, /\.filter\(p=>\['won','in_production'\]\.includes\(p\.stage\) && !\(Array\.isArray\(p\.productionOrderIds\) && p\.productionOrderIds\.length\)\s*&& !\(p\.flowVersion === 2 && p\.stage === 'won'\)\);/);
  });
  it('P4 Job Orders tab: the same condition', () => {
    assert.match(PROD, /\.filter\(p=>!\['paid','cancelled'\]\.includes\(p\.stage\) && !\(p\.flowVersion === 2 && p\.stage === 'won'\)\);/);
  });
  it('P5 the job detail footer: no Job Order and no Advance button for a flow-2 job at "won" (release happens only through Generate)', () => {
    assert.match(PROD, /\['won','in_production'\]\.includes\(p\.stage\) && !\(p\.flowVersion === 2 && p\.stage === 'won'\)\?`<button class="btn-secondary" id="proj-job-btn">/);
    assert.match(PROD, /\(canAdvance&&next&&!\(p\.flowVersion === 2 && p\.stage === 'won'\)\?`<button class="btn-success" id="proj-advance-btn">/);
  });
  it('P6 the Drawings card shows the attached drawing instead of the approval buttons', () => {
    assert.ok(PROD.includes('const handoffDwg = (p.handoffDrawing && p.handoffDrawing.url) ? p.handoffDrawing : null;'));
    assert.ok(PROD.includes(`<span class="badge badge-green" style="font-size:9px">Drawing attached by Sales</span>`));
    assert.ok(PROD.includes("handoffDwg.source==='client' ? 'Client-supplied drawing' : 'Our drawing'"));
    assert.match(PROD, /\$\{\(!handoffDwg && !isBsOnlyU && canEditDept\('Design'\)[^}]*id="jpd-send-approval"/);
    assert.match(PROD, /\$\{\(!handoffDwg && !isBsOnlyU && canEditDept\('Sales'\) && designApprovalOf\(p\)\.status==='pending'\)\?`/);
    assert.ok(PROD.includes('target="_blank" rel="noopener">${emojiIcon(\'📄\',14)} Open</a>'));
    assert.ok(PROD.includes('const hu = safeHttpUrl(handoffDwg.url);'), 'the file link is validated, never an unchecked href');
  });
  it('P7 Production-only viewers never see a Payment Acknowledgement (the document type that replaced the BIR receipt title)', () => {
    const m = PROD.match(/const visDocs = .*?!\(\/(receipt\|invoice\|billing[^/]*)\/i\.test\(dc\.type\|\|''\)/);
    assert.ok(m, 'visDocs filter not found');
    const re = new RegExp(m[1], 'i');
    for (const hidden of ['Payment Acknowledgement', 'Official Receipt', 'Billing Invoice', 'Downpayment Invoice', 'Statement of Account', 'Billing Statement', 'Delivery Receipt']) assert.ok(re.test(hidden), hidden + ' should be hidden');
    for (const shown of ['Client drawing', 'Drawing', 'Sales Order', 'Quotation', 'Job Order', 'Delivery Note']) assert.ok(!re.test(shown), shown + ' should stay visible');
  });
  it('nothing Generate writes for Production carries a peso sign (the timeline filter drops any event containing one)', () => {
    const dept = read('js/departments.js');
    for (const ev of ['Moved to In Production', 'Moved to In Design (payment confirmed)', 'Sales order & job order generated']) assert.ok(dept.includes(ev) && !ev.includes('₱'), ev);
  });
});

describe('SF19 closePrepaidJobIfDelivered: a fully prepaid job closes by itself after delivery', () => {
  const run = async (jobOver = {}, orders = {}, opts = {}) => {
    const env = makeEnv(SALES, { seed: { job_projects: { prj1: job({ stage: 'delivered', ...jobOver }) }, production_orders: orders }, ...opts });
    const res = await env.ctx.closePrepaidJobIfDelivered('prj1', 'Uriel');
    return { env, res, p: env.db.store.job_projects.get('prj1') };
  };
  it('closes it: stage "paid", a timeline line with no pesos, the cache dropped, an audit row — and the President is told', async () => {
    const { env, res, p } = await run({}, { w1: order() });
    assert.equal(res, true);
    assert.equal(p.stage, 'paid');
    const line = p.timeline.find((t) => t.event === 'Closed — delivered and fully paid');
    assert.ok(line && line.by === 'Uriel' && !line.event.includes('₱'));
    assert.ok(env.invalidated.includes('job_projects'));
    assert.ok(env.audits.some((a) => a[1] === 'project' && a[2] === 'prj1' && a[3].stage === 'paid' && a[3].autoClosed === true));
    const n = env.notifs.find((x) => x.kind === 'owner');
    same([n.title, n.type, n.link], ['✅ Job closed', 'project_paid', 'projects-lifecycle']);
    assert.equal(n.body, 'Mang Inasal (JP-2611-004) was delivered and is fully paid, so it closed by itself.');
  });
  it('a job with no work orders at all closes too (delivered at the job level)', async () => {
    assert.equal((await run({}, {})).res, true);
  });
  it('an over-collected job closes, and so does a contract the float sum would miss by a hair', async () => {
    assert.equal((await run({ amountCollected: 120000 }, {})).res, true);
    assert.equal((await run({ contractAmount: 0.3, amountCollected: 0.1 + 0.2 }, {})).res, true);
  });
  it('NOT while any money is still owed: the job stays "delivered" and nobody is told it closed', async () => {
    const { env, res, p } = await run({ amountCollected: 99999.99 }, { w1: order() });
    assert.equal(res, false); assert.equal(p.stage, 'delivered');
    assert.equal(env.notifs.length, 0);
    assert.equal(env.db.log.filter((l) => l.op === 'update').length, 0);
  });
  it('NOT with no contract on file (nothing to prove it was prepaid)', async () => {
    assert.equal((await run({ contractAmount: 0, amountCollected: 0 }, {})).res, false);
    assert.equal((await run({ contractAmount: undefined }, {})).res, false);
  });
  it('NOT unless the job is at "delivered" right now: earlier, later and closed stages are left alone', async () => {
    for (const stage of ['won', 'in_design', 'in_production', 'for_delivery', 'completed', 'paid', 'cancelled']) {
      const { res, p } = await run({ stage }, { w1: order() });
      assert.equal(res, false, stage); assert.equal(p.stage, stage, stage);
    }
  });
  it('NOT while a work order is still open — a job with several is finished only when the last one is delivered (legacy stage names included)', async () => {
    for (const open of ['layouting', 'qc', 'out_for_delivery', 'queued', 'ready', undefined]) {
      const { res, p } = await run({}, { w1: order(), w2: order({ orderNo: 'WO-2', stage: open }) });
      assert.equal(res, false, String(open)); assert.equal(p.stage, 'delivered');
    }
    assert.equal((await run({}, { w1: order(), w2: order({ orderNo: 'WO-2' }) })).res, true, 'both delivered');
    assert.equal((await run({}, { other: order({ projectId: 'someone-else', stage: 'layouting' }) })).res, true, "another job's open work order does not count");
  });
  it('never throws: a missing job, an unreadable job, or an unreadable work-order list leaves the job as it was', async () => {
    const env = makeEnv(SALES, { seed: {} });
    assert.equal(await env.ctx.closePrepaidJobIfDelivered('nope', 'x'), false);
    assert.equal(await env.ctx.closePrepaidJobIfDelivered('', 'x'), false);
    assert.equal(await env.ctx.closePrepaidJobIfDelivered(undefined, 'x'), false);
    const e2 = makeEnv(SALES, { seed: { job_projects: { prj1: job({ stage: 'delivered' }) } } });
    const real = e2.db.collection.bind(e2.db);
    e2.db.collection = (c) => (c === 'production_orders' ? { where: () => ({ get: async () => { throw new Error('permission-denied'); } }) } : real(c));
    assert.equal(await e2.ctx.closePrepaidJobIfDelivered('prj1', 'x'), false);
    assert.equal(e2.db.store.job_projects.get('prj1').stage, 'delivered');
  });
  it('a failed notification never undoes the close', async () => {
    const env = makeEnv(SALES, { seed: { job_projects: { prj1: job({ stage: 'delivered' }) } } });
    env.ctx.Notifs.sendToOwner = async () => { throw new Error('push down'); };
    assert.equal(await env.ctx.closePrepaidJobIfDelivered('prj1', 'x'), true);
    assert.equal(env.db.store.job_projects.get('prj1').stage, 'paid');
  });
});

describe('SF19 the job-level Advance → Delivered', () => {
  const advance = async (jobOver = {}, orders = {}, nextId = 'delivered') => {
    const base = job({ stage: 'for_delivery', ...jobOver });
    const env = makeEnv(SALES, { seed: { job_projects: { prj1: base }, production_orders: orders } });
    await env.ctx.advanceProjectStage({ id: 'prj1', ...base }, nextId);
    return { env, p: env.db.store.job_projects.get('prj1') };
  };
  it('a fully prepaid job is delivered AND closed in one go: Finance is not asked to bill a balance that does not exist', async () => {
    const { env, p } = await advance({}, { w1: order() });
    assert.equal(p.stage, 'paid');
    assert.ok(p.timeline.some((t) => t.event === 'Moved to Delivered') && p.timeline.some((t) => t.event === 'Closed — delivered and fully paid'));
    assert.ok(!env.notifs.some((n) => n.kind === 'dept' && n.dept === 'Finance'), 'no "Ready to bill balance" for a prepaid job');
    assert.ok(env.notifs.some((n) => n.kind === 'owner' && n.title === '✅ Job closed'));
    assert.ok(env.toastMsgs().includes('Delivered — and closed, because it is fully paid'));
    assert.equal(env.closes, 1); assert.equal(env.rendered, 1);
  });
  it('a job with a balance still goes to "Delivered" and Finance is told the balance to collect (unchanged)', async () => {
    const { env, p } = await advance({ amountCollected: 40000 }, { w1: order() });
    assert.equal(p.stage, 'delivered');
    const f = env.notifs.find((n) => n.kind === 'dept' && n.dept === 'Finance');
    assert.equal(f.title, '📦 Ready to bill balance');
    assert.ok(f.body.includes('collect balance ₱60,000.00'));
    assert.ok(!env.notifs.some((n) => n.title === '✅ Job closed'));
    assert.ok(env.toastMsgs().includes('Moved to Delivered'));
  });
  it('a prepaid job with another work order still open is delivered but NOT closed, and Finance is not asked for a ₱0 balance', async () => {
    const { env, p } = await advance({}, { w1: order(), w2: order({ stage: 'assembly' }) });
    assert.equal(p.stage, 'delivered');
    assert.ok(!env.notifs.some((n) => n.kind === 'dept' && n.dept === 'Finance'));
    assert.ok(!env.notifs.some((n) => n.title === '✅ Job closed'));
  });
  it('other stages behave as before: nothing is auto-closed, "Paid" still tells the President it was paid', async () => {
    const a = await advance({ stage: 'in_production' }, {}, 'for_delivery');
    assert.equal(a.p.stage, 'for_delivery');
    const b = await advance({ stage: 'completed' }, {}, 'paid');
    assert.equal(b.p.stage, 'paid');
    assert.ok(b.env.notifs.some((n) => n.kind === 'owner' && n.title === '💰 Project paid'));
  });
});

describe('SF19 a work order marked Delivered syncs the job — the last one in completes it', () => {
  it('a single delivered work order on a prepaid job: the job moves to Delivered and closes', async () => {
    const env = makeEnv(SALES, { seed: { job_projects: { prj1: job({ stage: 'in_production' }) }, production_orders: { w1: order() } } });
    await env.ctx.syncJobFromProdStage('prj1', 'delivered');
    const p = env.db.store.job_projects.get('prj1');
    assert.equal(p.stage, 'paid');
    assert.ok(p.timeline.some((t) => t.event === 'Production: Delivered'));
    same(env.tracking.map((t) => t.patch.status), ['delivered']);
  });
  it('with two work orders, the first delivered leaves the job open (it is only at Delivered); the second delivered closes it', async () => {
    const env = makeEnv(SALES, { seed: { job_projects: { prj1: job({ stage: 'in_production' }) }, production_orders: { w1: order(), w2: order({ orderNo: 'WO-2', stage: 'qc' }) } } });
    await env.ctx.syncJobFromProdStage('prj1', 'delivered');
    assert.equal(env.db.store.job_projects.get('prj1').stage, 'delivered');
    await env.db.collection('production_orders').doc('w2').update({ stage: 'delivered' });
    await env.ctx.syncJobFromProdStage('prj1', 'delivered');
    assert.equal(env.db.store.job_projects.get('prj1').stage, 'paid', 'the job was already at Delivered, so this call did not advance it — and still closed it');
  });
  it('a job with a balance is not closed by delivery; an earlier production stage never tries to close anything', async () => {
    const env = makeEnv(SALES, { seed: { job_projects: { prj1: job({ stage: 'in_production', amountCollected: 10 }) }, production_orders: { w1: order() } } });
    await env.ctx.syncJobFromProdStage('prj1', 'delivered');
    assert.equal(env.db.store.job_projects.get('prj1').stage, 'delivered');
    const e2 = makeEnv(SALES, { seed: { job_projects: { prj1: job({ stage: 'in_production' }) }, production_orders: { w1: order({ stage: 'qc' }) } } });
    await e2.ctx.syncJobFromProdStage('prj1', 'qc');
    assert.equal(e2.db.store.job_projects.get('prj1').stage, 'in_production');
    assert.ok(!e2.notifs.some((n) => n.title === '✅ Job closed'));
  });
  it('never regresses: a closed job stays closed when a work order is touched again', async () => {
    const env = makeEnv(SALES, { seed: { job_projects: { prj1: job({ stage: 'paid' }) }, production_orders: { w1: order() } } });
    await env.ctx.syncJobFromProdStage('prj1', 'delivered');
    assert.equal(env.db.store.job_projects.get('prj1').stage, 'paid');
  });
});
