// tests/flow-core.test.mjs — js/flow-core.js, the first half (specs/SALES-FLOW-SPEC-2026-11-19.md §5.4 J8 / J9, §13.2 Phase 4, owner ruling SF19).
//
// Pure logic: the stage key table (jobStage), the J8 guard (canComplete), the J9 close (shouldClose / planClose) and the stageAt stamp.
// MONEY-ADJACENT: shouldClose decides when a job is closed, so each rule has a test, mutation-checked (the list is in the hand-back).
//
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../js/money-core.js');
require('../js/sales-flow-core.js');
const FC = require('../js/flow-core.js');
const SOURCE = fs.readFileSync(new URL('../js/flow-core.js', import.meta.url), 'utf8');

const ORDER_STATES = {
  awaiting: { flowVersion: 2, status: 'awaiting_confirmation' },
  rejected: { flowVersion: 2, status: 'payment_rejected' },
  legacy: { status: 'pending' },
  confirmed: { flowVersion: 2, status: 'recorded' },
};
const wo = (stage, over = {}) => ({ stage, ...over });
const acc = (over = {}) => ({ url: 'https://x.test/a.pdf', name: 'a.pdf', signedBy: 'Maria Cruz', date: '2026-11-19', by: 'u1', byName: 'Rene', at: '2026-11-19T01:00:00.000Z', ...over });
const cleared = (over = {}) => ({ items: [{ text: 'Re-seal the sink', done: true }], clearedAt: '2026-11-19T02:00:00.000Z', clearedBy: 'Rene', ...over });
const settled = (over = {}) => ({ stage: 'completed', contractAmount: 100000, amountCollected: 100000, arBalance: 0, ...over });

describe('jobStage — every row of the §5.4 table', () => {
  it('cancelled: project.stage cancelled (wins over everything, even a paid-looking order)', () => {
    assert.equal(FC.jobStage({ project: { stage: 'cancelled' }, order: ORDER_STATES.confirmed, workOrders: [wo('out_for_delivery')] }), 'cancelled');
  });
  it('closed: project.stage paid', () => assert.equal(FC.jobStage({ project: { stage: 'paid' }, workOrders: [wo('qc')] }), 'closed'));
  it('balance: project.stage completed', () => assert.equal(FC.jobStage({ project: { stage: 'completed' } }), 'balance'));
  it('turnover: project.stage delivered (even with a work order still at out_for_delivery)', () => {
    assert.equal(FC.jobStage({ project: { stage: 'delivered' } }), 'turnover');
    assert.equal(FC.jobStage({ project: { stage: 'delivered' }, workOrders: [wo('out_for_delivery')] }), 'turnover');
  });
  it('delivery: project.stage for_delivery, OR any work order at out_for_delivery (legacy "ready" included)', () => {
    assert.equal(FC.jobStage({ project: { stage: 'for_delivery' } }), 'delivery');
    assert.equal(FC.jobStage({ project: { stage: 'in_production' }, workOrders: [wo('assembly'), wo('out_for_delivery')] }), 'delivery');
    assert.equal(FC.jobStage({ project: { stage: 'in_production' }, workOrders: [wo('ready')] }), 'delivery');
  });
  it('qc: in_production and EVERY open work order is at qc; a delivered one does not count as open', () => {
    assert.equal(FC.jobStage({ project: { stage: 'in_production' }, workOrders: [wo('qc')] }), 'qc');
    assert.equal(FC.jobStage({ project: { stage: 'in_production' }, workOrders: [wo('qc'), wo('qc'), wo('delivered')] }), 'qc');
    assert.equal(FC.jobStage({ project: { stage: 'in_production' }, workOrders: [wo('qc'), wo('finishing')] }), 'fabrication');
    assert.equal(FC.jobStage({ project: { stage: 'in_production' }, workOrders: [wo('qc'), wo('cutting')] }), 'fabrication', 'legacy cutting normalises to bending_cutting');
    assert.equal(FC.jobStage({ project: { stage: 'in_production' }, workOrders: [wo('qc'), wo('layouting', { status: 'cancelled' })] }), 'qc', 'a cancelled work order is not open');
  });
  it('fabrication: in_production with no work orders, or no qc-only set', () => {
    assert.equal(FC.jobStage({ project: { stage: 'in_production' } }), 'fabrication');
    assert.equal(FC.jobStage({ project: { stage: 'in_production' }, workOrders: [] }), 'fabrication');
    assert.equal(FC.jobStage({ project: { stage: 'in_production' }, workOrders: [wo('delivered')] }), 'fabrication', 'no OPEN work order is not "all at qc"');
  });
  it('design: project.stage in_design', () => assert.equal(FC.jobStage({ project: { stage: 'in_design' } }), 'design'));
  it('so_jo: the order is confirmed and the job has not moved on (stage won, or no job yet)', () => {
    assert.equal(FC.jobStage({ order: ORDER_STATES.confirmed, project: { stage: 'won' } }), 'so_jo');
    assert.equal(FC.jobStage({ order: ORDER_STATES.confirmed }), 'so_jo');
  });
  it('payment: order awaiting_confirmation, rejected or legacy_pending', () => {
    assert.equal(FC.jobStage({ order: ORDER_STATES.awaiting }), 'payment');
    assert.equal(FC.jobStage({ order: ORDER_STATES.rejected }), 'payment');
    assert.equal(FC.jobStage({ order: ORDER_STATES.legacy }), 'payment');
  });
  it('first match wins, from the end of the flow backward', () => {
    assert.equal(FC.jobStage({ project: { stage: 'in_design' }, order: ORDER_STATES.awaiting }), 'design');
    assert.equal(FC.jobStage({ project: { stage: 'for_delivery' }, workOrders: [wo('qc')] }), 'delivery');
    assert.equal(FC.jobStage({ project: { stage: 'completed' }, workOrders: [wo('out_for_delivery')] }), 'balance');
  });
  it('nothing matches -> null, and missing arguments never throw', () => {
    assert.equal(FC.jobStage({ project: { stage: 'won' } }), null);
    assert.equal(FC.jobStage({}), null);
    assert.equal(FC.jobStage(), null);
    assert.equal(FC.jobStage({ project: null, order: null, workOrders: null }), null);
  });
  it('the order part is SalesFlow.orderState (not a copy): sentToProduction with no job stage matches no row', () => {
    assert.equal(FC.jobStage({ order: { sentToProduction: true, status: 'recorded', flowVersion: 2 } }), null);
  });
});

describe('keyForProjectStage / stageStamp', () => {
  it('maps every job stage to its §5.4 key; "won" has none', () => {
    assert.deepEqual(['in_design', 'in_production', 'for_delivery', 'delivered', 'completed', 'paid', 'cancelled', 'won'].map(FC.keyForProjectStage),
      ['design', 'fabrication', 'delivery', 'turnover', 'balance', 'closed', 'cancelled', null]);
  });
  it('agrees with jobStage: the key a stage maps to is the key jobStage reads back', () => {
    for (const s of ['in_design', 'for_delivery', 'delivered', 'completed', 'paid', 'cancelled']) assert.equal(FC.jobStage({ project: { stage: s } }), FC.keyForProjectStage(s), s);
  });
  it('is a dotted stageAt.<key> path with the ISO string; an unknown key or no time stamps nothing', () => {
    assert.deepEqual(FC.stageStamp('turnover', '2026-11-19T01:00:00.000Z'), { 'stageAt.turnover': '2026-11-19T01:00:00.000Z' });
    assert.deepEqual(FC.stageStamp('closed', 'X'), { 'stageAt.closed': 'X' });
    assert.deepEqual(FC.stageStamp('nope', 'X'), {});
    assert.deepEqual(FC.stageStamp('closed', ''), {});
  });
});

describe('canComplete — the J8 guard', () => {
  const ready = () => ({ acceptance: acc(), punchList: cleared() });
  it('acceptance (url + signedBy + date) AND a cleared punch list -> true, no blockers', () => {
    assert.equal(FC.canComplete(ready()), true);
    assert.deepEqual(FC.completeBlockers(ready()), []);
  });
  it('no acceptance at all -> blocked, code "acceptance"', () => {
    assert.equal(FC.canComplete({ punchList: cleared() }), false);
    assert.deepEqual(FC.completeBlockers({ punchList: cleared() }), ['acceptance']);
  });
  it('an acceptance missing its file, its signer or its date is not an acceptance (each alone)', () => {
    for (const k of ['url', 'signedBy', 'date']) {
      assert.equal(FC.canComplete({ acceptance: acc({ [k]: '' }), punchList: cleared() }), false, k);
      assert.equal(FC.canComplete({ acceptance: acc({ [k]: '   ' }), punchList: cleared() }), false, k + ' blank');
      assert.equal(FC.canComplete({ acceptance: acc({ [k]: undefined }), punchList: cleared() }), false, k + ' undefined');
    }
  });
  it('a punch list never marked cleared blocks, EVEN WHEN EMPTY (an empty list counts only once it was explicitly cleared)', () => {
    assert.equal(FC.canComplete({ acceptance: acc() }), false);
    assert.equal(FC.canComplete({ acceptance: acc(), punchList: { items: [] } }), false);
    assert.equal(FC.canComplete({ acceptance: acc(), punchList: [] }), false);
    assert.deepEqual(FC.completeBlockers({ acceptance: acc() }), ['punch_list']);
  });
  it('an explicitly cleared EMPTY list is cleared', () => {
    assert.equal(FC.canComplete({ acceptance: acc(), punchList: { items: [], clearedAt: 'x', clearedBy: 'Rene' } }), true);
  });
  it('a cleared mark with an item still open does not count (an item added after clearing blocks again)', () => {
    assert.equal(FC.canComplete({ acceptance: acc(), punchList: cleared({ items: [{ text: 'a', done: true }, { text: 'b', done: false }] }) }), false);
  });
  it('a blank item text is not an item; a bare array is never "cleared"', () => {
    assert.equal(FC.canComplete({ acceptance: acc(), punchList: cleared({ items: [{ text: '  ', done: false }, { text: 'a', done: true }] }) }), true);
    assert.equal(FC.canComplete({ acceptance: acc(), punchList: [{ text: 'a', done: true }] }), false);
  });
  it('both missing -> both blockers; a missing project never throws', () => {
    assert.deepEqual(FC.completeBlockers({}), ['acceptance', 'punch_list']);
    assert.equal(FC.canComplete(null), false);
    assert.equal(FC.canComplete(undefined), false);
  });
});

describe('shouldClose — the J9 rule', () => {
  it('completed, balance 0, no credit -> closes', () => assert.equal(FC.shouldClose(settled()), true));
  it('only a COMPLETED job closes: every other stage does not, however well paid', () => {
    for (const s of ['won', 'in_design', 'in_production', 'for_delivery', 'delivered', 'paid', 'cancelled', undefined]) assert.equal(FC.shouldClose(settled({ stage: s })), false, String(s));
  });
  it('a balance above zero keeps it open; the ±0.005 tolerance: 0.004 closes, 0.005 closes, 0.006 does not', () => {
    assert.equal(FC.shouldClose(settled({ arBalance: 0.01 })), false);
    assert.equal(FC.shouldClose(settled({ arBalance: 35000 })), false);
    assert.equal(FC.shouldClose(settled({ arBalance: 0.004 })), true);
    assert.equal(FC.shouldClose(settled({ arBalance: 0.005 })), true);
    assert.equal(FC.shouldClose(settled({ arBalance: 0.006 })), false);
  });
  it('a negative balance (over-collected) closes', () => assert.equal(FC.shouldClose(settled({ arBalance: -100 })), true));
  it('client credit blocks: any credit above zero keeps it open; 0, undefined, null and "" do not', () => {
    assert.equal(FC.shouldClose(settled({ clientCredit: 0.01 })), false);
    assert.equal(FC.shouldClose(settled({ clientCredit: 5000 })), false);
    for (const c of [0, undefined, null, '', -3]) assert.equal(FC.shouldClose(settled({ clientCredit: c })), true, String(c));
  });
  it('arBalance is the stored figure when there is one — even 0 beats a stale contract − collected', () => {
    assert.equal(FC.shouldClose(settled({ arBalance: 0, contractAmount: 100000, amountCollected: 10 })), true);
    assert.equal(FC.shouldClose(settled({ arBalance: 500, contractAmount: 100000, amountCollected: 100000 })), false);
  });
  it('with no stored balance it is contract − collected, but only when there IS a contract (an unknown balance never closes)', () => {
    assert.equal(FC.shouldClose({ stage: 'completed', contractAmount: 100000, amountCollected: 100000 }), true);
    assert.equal(FC.shouldClose({ stage: 'completed', contractAmount: 100000, amountCollected: 60000 }), false);
    assert.equal(FC.shouldClose({ stage: 'completed', contractAmount: 100000, amountCollected: 60000, arBalance: null }), false);
    assert.equal(FC.shouldClose({ stage: 'completed', contractAmount: 100000, amountCollected: 100000, arBalance: '' }), true);
    assert.equal(FC.shouldClose({ stage: 'completed' }), false);
    assert.equal(FC.shouldClose({ stage: 'completed', contractAmount: 0, amountCollected: 0 }), false);
  });
  it('null / undefined never throw and never close', () => { assert.equal(FC.shouldClose(null), false); assert.equal(FC.shouldClose(), false); });
});

describe('planClose', () => {
  const ctx = { nowIso: '2026-11-20T03:00:00.000Z', who: 'Uriel' };
  it('a settled job: stage paid, closedAt, stageAt.closed, and a timeline event', () => {
    const plan = FC.planClose(settled(), ctx);
    assert.deepEqual(plan.fields, { stage: 'paid', closedAt: ctx.nowIso, 'stageAt.closed': ctx.nowIso });
    assert.deepEqual(plan.timelineEvent, { at: ctx.nowIso, event: 'Closed — accepted and fully paid', by: 'Uriel' });
  });
  it('NO PESOS anywhere in the plan (Production reads the timeline)', () => {
    const plan = FC.planClose(settled({ arBalance: 0, contractAmount: 123456.78 }), ctx);
    assert.doesNotMatch(JSON.stringify(plan), /₱|PHP|123456|123,456/);
    assert.doesNotMatch(plan.timelineEvent.event, /\d/);
  });
  it('never touches a money key', () => {
    const keys = Object.keys(FC.planClose(settled(), ctx).fields);
    for (const k of ['amountCollected', 'arBalance', 'payments', 'contractAmount', 'clientCredit', 'refunds', 'invoices', 'dpPercent', 'balanceSchedule', 'joRev', 'capital']) assert.ok(!keys.includes(k), k);
    assert.deepEqual(keys.sort(), ['closedAt', 'stage', 'stageAt.closed']);
  });
  it('null whenever shouldClose is false (balance, credit, wrong stage)', () => {
    assert.equal(FC.planClose(settled({ arBalance: 1 }), ctx), null);
    assert.equal(FC.planClose(settled({ clientCredit: 1 }), ctx), null);
    assert.equal(FC.planClose(settled({ stage: 'delivered' }), ctx), null);
    assert.equal(FC.planClose(null, ctx), null);
  });
  it('does not mutate the project', () => {
    const p = settled(); const before = JSON.stringify(p);
    FC.planClose(p, ctx);
    assert.equal(JSON.stringify(p), before);
  });
});

describe('file contract', () => {
  it('pure: no DOM, no Firestore, no clock, no imports', () => {
    const code = SOURCE.replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /document\.|firebase|Date\.now|new Date|require\(|import /);
  });
});
