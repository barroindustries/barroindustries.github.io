// tests/payment-claims-changeorder.test.mjs — js/payment-claims-core.js, Phase 5 (specs/SALES-FLOW-SPEC-2026-11-19.md §5.7 C4, §8.3): the change-order down payment.
//
// MONEY logic. A change order's down payment is asked BEFORE the contract is revised, so the job's balance does not yet hold the change order's price. The ceiling a
// change-order claim may reach is therefore the balance due PLUS the change order's price (when positive) — on the record form AND at the confirmation. Every other claim
// is judged exactly as before. Mutation-checked in a scratch copy (see the hand-back).
//
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../js/money-core.js');
require('../js/sales-flow-core.js');
const PC = require('../js/payment-claims-core.js');

const PRES = { uid: 'u-pres', isPresident: true, isFinanceTier: false };
const claim = (over = {}) => ({ id: 'clm1', kind: 'change_order', changeOrderId: 'co1', orderId: 'ord1', projectId: 'prj1', clientName: 'Acme Foods', paymentReceived: 9000, paymentMethod: 'bank', vatTreatment: 'inclusive', orRef: 'OR-1', paymentDate: '2026-11-21', receiptUrl: 'https://x/r.jpg', status: 'pending', createdBy: 'u-sales', createdByName: 'Uriel', ...over });
const project = (over = {}) => ({ id: 'prj1', projectNo: 'JP-1', stage: 'in_production', contractAmount: 100000, amountCollected: 100000, arBalance: 0, ...over });
const ctxOf = (over = {}) => ({ today: '2026-11-21', nowIso: '2026-11-21T02:00:00.000Z', who: 'Neil Barro', viewer: PRES, paNumber: 'PA-0003', acct: {}, bankTag: {}, sanitize: (r) => String(r), ...over });
const U = (...xs) => ({ __union: xs });

describe('dueFor — what a payment of this kind may reach', () => {
  it('a change-order down payment may reach the balance PLUS the change order\'s price; a prepaid job (balance 0) still takes it', () => {
    assert.equal(PC.dueFor('change_order', project(), [], { price: 18000 }), 18000);
    assert.equal(PC.dueFor('change_order', project({ amountCollected: 65000, arBalance: 35000 }), [], { price: 18000 }), 53000);
  });
  it('every other kind is judged on the balance alone, even when a change order is passed (a balance payment is never raised by a change order)', () => {
    for (const kind of ['balance', 'progress']) assert.equal(PC.dueFor(kind, project({ amountCollected: 65000, arBalance: 35000 }), [], { price: 18000 }), 35000, kind);
    assert.equal(PC.dueFor('balance', project(), [], { price: 18000 }), 0);
  });
  it('a price that is zero, negative, missing or not a number adds nothing; no change order is the old behaviour', () => {
    const p = project({ amountCollected: 65000, arBalance: 35000 });
    for (const co of [{ price: 0 }, { price: -5000 }, { price: undefined }, { price: 'x' }, {}, null, undefined]) assert.equal(PC.dueFor('change_order', p, [], co), 35000, JSON.stringify(co));
  });
  it('a site-visit fee the client already paid counts toward what is owed (§5.6: it is credited by this very payment)', () => {
    const p = project({ amountCollected: 65000, arBalance: 35000 });
    assert.equal(PC.dueFor('change_order', p, [{ id: 'f1', recordedAmount: 1000 }], { price: 18000 }), 52000);
    assert.equal(PC.dueFor('change_order', project(), [{ id: 'f1', recordedAmount: 1000 }], { price: 18000 }), 17000, 'paid-up job: 100,000 + 18,000 − 100,000 − 1,000');
    assert.equal(PC.dueFor('change_order', project(), [{ id: 'f1', recordedAmount: 99999 }], { price: 18000 }), 0, 'never below zero');
  });
  it('an EARLIER down payment on the same change order counts: on a prepaid job two payments cannot each reach the whole price (worked from contract and collected, not the floored balance)', () => {
    const afterFirst = project({ amountCollected: 109000, arBalance: 0 });          // 9,000 of the 18,000 change order is already collected
    assert.equal(PC.dueFor('change_order', afterFirst, [], { price: 18000 }), 9000);
    assert.equal(PC.validateRecord({ kind: 'change_order', entered: 9000.5, vatTreatment: 'inclusive', hasReceipt: true, project: afterFirst, changeOrder: { price: 18000 } }).ok, true);
    assert.equal(PC.validateRecord({ kind: 'change_order', entered: 9000.51, vatTreatment: 'inclusive', hasReceipt: true, project: afterFirst, changeOrder: { price: 18000 } }).ok, false);
    const allPaid = project({ amountCollected: 118000, arBalance: 0 });
    assert.equal(PC.dueFor('change_order', allPaid, [], { price: 18000 }), 0);
    assert.equal(PC.planConfirmation(claim({ paymentReceived: 1 }), allPaid, ctxOf({ changeOrder: { price: 18000 } })).code, 'over-balance');
  });
  it('a job with no contract figure falls back to balance + price (no invention)', () => {
    assert.equal(PC.dueFor('change_order', { id: 'p', arBalance: 5000 }, [], { price: 18000 }), 23000);
    assert.equal(PC.dueFor('change_order', null, [], { price: 18000 }), 0);
  });
});

describe('validateRecord — the record form for a change-order down payment', () => {
  const v = (o) => PC.validateRecord({ kind: 'change_order', entered: 9000, vatTreatment: 'inclusive', hasReceipt: true, project: project(), changeOrder: { price: 18000 }, ...o });
  it('accepts up to balance + price (+₱0.50), and reports that ceiling as the balance due', () => {
    assert.equal(v().ok, true); assert.equal(v().balanceDue, 18000);
    assert.equal(v({ entered: 18000.5 }).ok, true);
    const over = v({ entered: 18000.51 });
    assert.equal(over.ok, false); assert.match(over.error, /more than the balance due/);
  });
  it('without a change order the same payment on a paid-up job is refused, exactly as before', () => {
    const r = PC.validateRecord({ kind: 'change_order', entered: 9000, vatTreatment: 'inclusive', hasReceipt: true, project: project() });
    assert.equal(r.ok, false); assert.match(r.error, /more than the balance due/); assert.equal(r.balanceDue, 0);
  });
  it('a balance payment on the same paid-up job is refused even if a change order is passed in', () => {
    assert.equal(PC.validateRecord({ kind: 'balance', entered: 100, vatTreatment: 'inclusive', hasReceipt: true, project: project(), changeOrder: { price: 18000 } }).ok, false);
  });
  it('proof is still required and an amount is still needed', () => {
    assert.match(v({ hasReceipt: false }).error, /receipt or proof/); assert.match(v({ entered: 0 }).error, /amount/);
  });
});

describe('planConfirmation — the same ceiling at the confirmation', () => {
  const plan = (c, p, ctx) => PC.planConfirmation(c, p, ctxOf(ctx));
  it('confirms up to balance + price and refuses one centavo more (over-balance, reporting the ceiling)', () => {
    assert.equal(plan(claim({ paymentReceived: 18000.5 }), project(), { changeOrder: { price: 18000 } }).ok, true);
    const r = plan(claim({ paymentReceived: 18000.51 }), project(), { changeOrder: { price: 18000 } });
    assert.equal(r.ok, false); assert.equal(r.code, 'over-balance'); assert.equal(r.balanceDue, 18000);
  });
  it('no change order given: a down payment on a paid-up job is over-balance (the old behaviour)', () => {
    const r = plan(claim(), project(), {});
    assert.equal(r.ok, false); assert.equal(r.code, 'over-balance');
  });
  it('a balance claim is not raised by a change order in the context', () => {
    const r = plan(claim({ kind: 'balance', changeOrderId: null }), project(), { changeOrder: { price: 18000 } });
    assert.equal(r.ok, false); assert.equal(r.code, 'over-balance');
  });
  it('the plan itself is unchanged: collected adds the payment, the claim is recorded, no stage key, the document is the Payment Acknowledgement', () => {
    const r = plan(claim(), project(), { changeOrder: { price: 18000 } });
    assert.equal(r.ok, true); assert.equal(r.newCollected, 109000); assert.equal(r.newAR, 0); assert.equal(r.claimPatch.status, 'recorded'); assert.ok(!('stage' in r.claimPatch));
    assert.equal(r.document.type, 'Payment Acknowledgement'); assert.equal(r.payment.type, 'Change-order down payment'); assert.equal(r.payment.claimId, 'clm1');
  });
  it('a repair (the ledger row already exists) does not re-judge the balance', () => {
    assert.equal(plan(claim({ paymentReceived: 99999 }), project(), { repair: true, changeOrder: { price: 1 } }).ok, true);
  });
});

describe('runConfirmation — reads the change order for a change-order claim, and only for one', () => {
  function world({ c = claim(), p = project(), co = { pricing: { price: 18000 } } } = {}) {
    const w = { claim: c, project: p, ledger: {}, ledgerCalls: [], patches: [], coReads: [] };
    const deps = {
      getClaim: async () => w.claim, getProject: async () => w.project,
      getChangeOrder: async (id) => { w.coReads.push(id); return co; },
      ledgerPost: async (entry) => { w.ledgerCalls.push(entry); if (w.ledger[entry.ref]) return { existed: true }; w.ledger[entry.ref] = entry; return { existed: false }; },
      ledgerAmount: async (ref) => (w.ledger[ref] ? w.ledger[ref].amount : null),
      updateClaim: async (id, patch) => { w.patches.push(patch); w.claim = Object.assign({}, w.claim, patch); },
      ctx: ctxOf(), sanitize: (r) => String(r), union: U, serverTime: () => 'TS',
    };
    return { w, deps };
  }
  it('posts once for a prepaid job when the change order\'s price covers it: one ledger row carrying the job update, the change order read by its id', async () => {
    const { w, deps } = world();
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.ok, true); assert.equal(r.code, 'posted'); assert.equal(w.ledgerCalls.length, 1); assert.deepEqual(w.coReads, ['co1']);
    assert.equal(w.ledgerCalls[0].projectSync.fields.amountCollected, 109000);
  });
  it('refuses (over-balance, nothing written) when the payment is above balance + price', async () => {
    const { w, deps } = world({ c: claim({ paymentReceived: 18001 }) });
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.ok, false); assert.equal(r.code, 'over-balance'); assert.equal(w.ledgerCalls.length, 0); assert.equal(w.patches.length, 0);
  });
  it('an APPLIED change order is already in the contract: its price is not owed a second time (a late claim is judged on the balance alone)', async () => {
    const applied = { status: 'applied', appliedContractRev: 1, pricing: { price: 18000 } };
    const { w, deps } = world({ co: applied, p: project({ contractAmount: 118000, amountCollected: 118000, arBalance: 0 }) });
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.ok, false); assert.equal(r.code, 'over-balance'); assert.equal(w.ledgerCalls.length, 0);
    const { deps: d2 } = world({ co: { status: 'applied', pricing: { price: 18000 } }, p: project({ contractAmount: 118000, amountCollected: 118000, arBalance: 0 }) });
    assert.equal((await PC.runConfirmation('clm1', d2)).code, 'over-balance', 'status applied alone is enough');
    const open = world({ co: { status: 'signed', pricing: { price: 18000 } } });
    assert.equal((await PC.runConfirmation('clm1', open.deps)).code, 'posted', 'a signed one that is not applied still counts');
  });
  it('a change order that cannot be found leaves the old ceiling (balance alone): a prepaid job refuses', async () => {
    const { w, deps } = world({ co: null });
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.ok, false); assert.equal(r.code, 'over-balance'); assert.equal(w.ledgerCalls.length, 0);
  });
  it('no reader injected (an older caller): the old behaviour, no throw', async () => {
    const { w, deps } = world(); delete deps.getChangeOrder;
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.code, 'over-balance'); assert.equal(w.coReads.length, 0);
  });
  it('a balance claim never reads a change order', async () => {
    const { w, deps } = world({ c: claim({ kind: 'balance', changeOrderId: null, paymentReceived: 100 }), p: project({ amountCollected: 65000, arBalance: 35000 }) });
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.ok, true); assert.deepEqual(w.coReads, []);
  });
  it('a change-order claim with no changeOrderId reads nothing and keeps the old ceiling', async () => {
    const { w, deps } = world({ c: claim({ changeOrderId: null }) });
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.code, 'over-balance'); assert.deepEqual(w.coReads, []);
  });
  it('a retry after the claim patch failed (the row is in the ledger) repairs without re-judging the balance and without touching the job', async () => {
    const { w, deps } = world();
    w.ledger['PAY-clm1'] = { ref: 'PAY-clm1', amount: 9000 };
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.ok, true); assert.equal(r.code, 'repaired'); assert.equal(w.ledgerCalls.length, 0);
  });
});
