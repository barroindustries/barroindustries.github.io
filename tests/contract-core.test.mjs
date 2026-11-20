// tests/contract-core.test.mjs — F3 "Revise contract amount", specs/SALES-FLOW-SPEC-2026-11-19.md §7.3-§7.10.
//
// js/contract-core.js is the pure core of a contract-amount revision: who has to act (gate), the exactly-once apply
// (planApply / runApply) and the refund of client credit (planRefund). MONEY logic: every rule below is mutation-tested
// (M1-M12 of §7.10; the list is in the WP-2A hand-back).
//
// Loads js/money-core.js, js/sales-flow-core.js, js/price-gate-core.js and js/contract-core.js as the app does.
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
require('../js/price-gate-core.js');
const CC = require('../js/contract-core.js');
const SOURCE = fs.readFileSync(new URL('../js/contract-core.js', import.meta.url), 'utf8');

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────
const PRES = { uid: 'u-pres', isPresident: true, isFinanceTier: false };
const FIN = { uid: 'u-fin', isPresident: false, isFinanceTier: true };
const SALES = { uid: 'u-sales', isPresident: false, isFinanceTier: false };
const BANK = { bankAccountId: 'ba1', bankAccountName: 'BDO Main' };

const pendingRev = (over = {}) => ({
  revNo: 1, kind: 'manual', fromAmount: 100000, toAmount: 120000, delta: 20000, changeReason: 'Added two shelves',
  quoteId: null, quoteColl: null, quoteNumber: null, changeOrderId: null,
  gate: { approval: 'none', reason: '', lastApproved: 100000, stdTotal: null, collected: 65000 },
  status: 'pending_confirm', requestedAt: '2026-11-19T01:00:00.000Z', requestedBy: 'u-sales', requestedByName: 'Uriel', resubmits: 0,
  decision: null, ...over,
});
const order = (over = {}) => ({
  id: 'ord123', soNumber: 'SO-0012', quoteId: 'quo1', quoteNumber: 'BK-1', clientName: 'Acme Foods', projectId: 'prj1',
  flowVersion: 2, status: 'recorded', contractAmount: 100000, createdBy: 'u-sales', trackingToken: 'tok',
  pendingRevision: pendingRev(), ...over,
});
const project = (over = {}) => ({ id: 'prj1', stage: 'production', amountCollected: 65000, contractAmount: 100000, joNumber: 'JO-0007', items: [{ name: 'A' }], ...over });
const U = (...xs) => ({ __union: xs });
const ctxOf = (over = {}) => ({
  today: '2026-11-20', nowIso: '2026-11-20T02:00:00.000Z', who: 'Neil Barro', viewer: PRES,
  sanitize: (r) => String(r).replace(/\//g, '_'), union: U, serverTime: () => 'SERVER_TS', deleteField: () => '__DELETE__', ...over,
});
const keysDeep = (v, acc = []) => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, acc));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.push(k); keysDeep(x, acc); }
  return acc;
};
const plan = (o, p, c) => CC.planApply(o, p, ctxOf(c));
// order with a revision to `to` from 100,000
const rev = (to, over = {}) => order({ pendingRevision: pendingRev({ toAmount: to, delta: to - 100000, ...over }) });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the module itself', () => {
  it('exposes exactly gate, lastApproved, planApply, runApply, planRefund', () => {
    assert.deepEqual(Object.keys(CC).sort(), ['gate', 'lastApproved', 'planApply', 'planRefund', 'runApply']);
    assert.equal(globalThis.window.ContractCore, CC);
  });
  it('keeps the file contract: shim on line 1, module.exports at the end, pure; never mentions money-core mutation', () => {
    assert.equal(SOURCE.split('\n')[0], "if (typeof window === 'undefined') globalThis.window = globalThis;");
    assert.ok(/module\.exports = window\.ContractCore;\s*$/.test(SOURCE));
    for (const banned of ['document.', 'firebase', 'db.collection', 'Date.now', 'new Date(', 'localStorage', 'innerHTML']) assert.ok(!SOURCE.includes(banned), banned);
  });
});

// ── (1)(2) gate ────────────────────────────────────────────────────────────────────────────────────────────────
describe('gate (§7.3)', () => {
  const g = (o) => CC.gate({ kind: 'manual', toAmount: 100, lastApproved: 100, stdTotal: null, collected: 0, ...o });
  it('(1) Choice B/C: toAmount >= lastApproved → none; equal is NOT below', () => {
    assert.equal(g({ toAmount: 100 }).approval, 'none');
    assert.equal(g({ toAmount: 100.004 }).approval, 'none');
    assert.equal(g({ toAmount: 150 }).approval, 'none');
    assert.equal(g({ kind: 'change_order', toAmount: 100 }).approval, 'none');
  });
  it('(1) below approved with stdTotal null → president (below_approved_and_standard)', () => {
    assert.deepEqual(g({ toAmount: 99 }), { approval: 'president', reason: 'below_approved_and_standard' });
    assert.deepEqual(g({ kind: 'change_order', toAmount: 99 }), { approval: 'president', reason: 'below_approved_and_standard' });
  });
  it('(1) below approved and below a KNOWN standard → president; at or above standard → none', () => {
    assert.equal(g({ toAmount: 90, stdTotal: 95 }).approval, 'president');
    assert.equal(g({ toAmount: 95, stdTotal: 95 }).approval, 'none');
    assert.equal(g({ toAmount: 96, stdTotal: 95 }).approval, 'none');
  });
  it('(1) Choice A with an approved quote revision → none, even below approved and standard', () => {
    assert.equal(g({ kind: 'quote_revision', toAmount: 50, stdTotal: 95 }).approval, 'none');
  });
  it('(1) Choice A with a quote revision NOT approved falls through to the B/C test', () => {
    assert.equal(g({ kind: 'quote_revision', quoteApproved: false, toAmount: 50 }).approval, 'president');
    assert.equal(g({ kind: 'quote_revision', quoteApproved: false, toAmount: 150 }).approval, 'none');
  });
  it('(1) legacy lastApproved fallback: lastApproved() = originalContractAmount, else contractAmount', () => {
    assert.equal(CC.lastApproved({ originalContractAmount: 80000, contractAmount: 100000 }), 80000);
    assert.equal(CC.lastApproved({ contractAmount: 100000 }), 100000);
    assert.equal(CC.lastApproved({}), 0);
  });
  it('(1) lastApproved(): the newest of the chain approval and a revision Neil decided himself', () => {
    const revisions = [{ decidedByRole: 'president', toAmount: 130000, decidedAt: '2026-11-10T00:00:00Z' }, { decidedByRole: 'finance', toAmount: 999999, decidedAt: '2026-11-15T00:00:00Z' }];
    assert.equal(CC.lastApproved({ chainApproved: { total: 100000, at: '2026-11-01T00:00:00Z' }, revisions, originalContractAmount: 50000 }), 130000);
    assert.equal(CC.lastApproved({ chainApproved: { total: 140000, at: '2026-11-12T00:00:00Z' }, revisions, originalContractAmount: 50000 }), 140000);
    assert.equal(CC.lastApproved({ chainApproved: { total: 140000, at: '2026-11-12T00:00:00Z' }, revisions: [{ decidedByRole: 'finance', toAmount: 1, decidedAt: '2026-11-30T00:00:00Z' }] }), 140000);
  });
  it('(2) toAmount < collected is president (overpayment) — even for an approved quote revision, even when above approved', () => {
    assert.deepEqual(g({ kind: 'quote_revision', toAmount: 50, collected: 65 }), { approval: 'president', reason: 'overpayment' });
    assert.deepEqual(g({ kind: 'manual', toAmount: 150, collected: 160, lastApproved: 100 }), { approval: 'president', reason: 'overpayment' });
    assert.equal(g({ toAmount: 65, collected: 65, lastApproved: 60 }).reason, '');                   // equal to collected is not overpayment
    assert.equal(g({ toAmount: 100, collected: 100 }).approval, 'none');
  });
  it('an unreadable amount goes to the President', () => {
    assert.equal(g({ toAmount: 'abc' }).approval, 'president');
    assert.equal(g({ toAmount: null }).approval, 'president');
  });
});

// ── (3)-(8) planApply numbers ──────────────────────────────────────────────────────────────────────────────────
describe('planApply — numbers and ledger entry (§7.4, §7.5)', () => {
  it('(3) increase 100,000 -> 120,000, collected 65,000: AR 55,000, credit 0; debit 20,000, ref SO-<id>-R1, asset', () => {
    const p = plan(rev(120000), project());
    assert.equal(p.ok, true);
    assert.equal(p.arAfter, 55000);
    assert.equal(p.clientCreditAfter, 0);
    assert.equal(p.projectFields.arBalance, 55000);
    assert.equal(p.projectFields.clientCredit, 0);
    assert.equal(p.projectFields.contractAmount, 120000);
    const e = p.ledgerEntry;
    assert.equal(e.kind, 'debit');
    assert.equal(e.amount, 20000);
    assert.equal(e.ref, 'SO-ord123-R1');
    assert.equal(e.accountType, 'asset');
    assert.equal(e.account, 'Accounts Receivable');
    assert.equal(e.category, 'Contract adjustment');
    assert.equal(e.source, 'Sales');
    assert.equal(e.projectId, 'prj1');
    assert.equal(e.date, '2026-11-20');
    assert.deepEqual(e.extra, { contractFrom: 100000, contractTo: 120000, signedDelta: 20000, revNo: 1, kind: 'manual', confirmedBy: 'Neil Barro' });
  });
  it('(4) decrease above collected: 100,000 -> 80,000, collected 65,000: AR 15,000; credit row of 20,000', () => {
    const p = plan(rev(80000), project({ amountCollected: 65000 }));
    assert.equal(p.arAfter, 15000);
    assert.equal(p.clientCreditAfter, 0);
    assert.equal(p.ledgerEntry.kind, 'credit');
    assert.equal(p.ledgerEntry.amount, 20000);
  });
  it('(4) a decrease with more balance left', () => {
    const p = plan(rev(80000, { gate: { approval: 'none' } }), project({ amountCollected: 30000 }));
    assert.equal(p.arAfter, 50000);
  });
  it('(5) decrease below collected: 100,000 -> 50,000, collected 65,000: AR 0, credit 15,000; ledger amount 50,000', () => {
    // one row for abs(delta) = |50,000 - 100,000| = 50,000 (not the new contract; here they coincide, so test 3 pins that)
    const p = plan(rev(50000), project({ amountCollected: 65000 }));
    assert.equal(p.arAfter, 0);
    assert.equal(p.clientCreditAfter, 15000);
    assert.equal(p.projectFields.arBalance, 0);
    assert.equal(p.projectFields.clientCredit, 15000);
    assert.equal(p.ledgerEntry.amount, 50000);
    assert.equal(p.ledgerEntry.kind, 'credit');
  });
  it('(6) second revision: ref ends -R2; originalContractAmount unchanged from the first', () => {
    const o = order({
      contractAmount: 120000, contractRev: 1, originalContractAmount: 100000,
      pendingRevision: pendingRev({ revNo: 2, fromAmount: 120000, toAmount: 130000, delta: 10000 }),
    });
    const p = plan(o, project({ contractAmount: 120000 }));
    assert.equal(p.ok, true);
    assert.equal(p.ledgerEntry.ref, 'SO-ord123-R2');
    assert.equal(p.orderPatch.originalContractAmount, 100000);
    assert.equal(p.orderPatch.contractRev, 2);
    assert.equal(p.projectFields.joRev, 2);
  });
  it('(6) the first revision stamps originalContractAmount from the contract it replaces', () => {
    assert.equal(plan(rev(120000), project()).orderPatch.originalContractAmount, 100000);
  });
  it('(7) no amountCollected / payments / stage key anywhere in the plan; never income', () => {
    for (const to of [120000, 80000, 50000, 100000]) {
      const p = plan(rev(to), project());
      assert.equal(p.ok, true);
      const keys = keysDeep({ pf: p.projectFields, op: p.orderPatch, rev: p.revision });
      for (const banned of ['amountCollected', 'payments', 'stage']) assert.ok(!keys.includes(banned), `${banned} found for to=${to}`);
      if (p.ledgerEntry) assert.notEqual(p.ledgerEntry.accountType, 'income');
    }
  });
  it('(8) timeline and document entries contain no peso sign', () => {
    const p = plan(rev(120000), project());
    const tl = JSON.stringify(p.projectFields.timeline);
    const docs = JSON.stringify(p.projectFields.documents);
    assert.ok(!tl.includes('₱') && !docs.includes('₱'));
    assert.ok(!JSON.stringify(p.projectFields.joRevNote).includes('₱'));
    assert.deepEqual(p.projectFields.timeline.__union[0].event, 'Contract revised — SO-0012 R1 / JO-0007 R1');
    assert.deepEqual(p.projectFields.documents.__union.map((d) => [d.type, d.ref]), [['Sales Order', 'SO-0012 R1'], ['Job Order', 'JO-0007 R1']]);
  });
  it('the books row is the receivable adjustment, described with pesos only on the ledger row', () => {
    const p = plan(rev(120000), project());
    assert.equal(p.ledgerEntry.description, 'Contract revised — Acme Foods (SO-0012 R1): ₱100000 → ₱120000');
  });
  it('rounds to centavos', () => {
    const p = plan(rev(100000.1 + 0.2), project());   // 100000.3 (float dust)
    assert.equal(p.ledgerEntry.amount, 0.3);
    assert.equal(p.arAfter, 35000.3);
  });
  it('the order patch carries the full revision record and deletes pendingRevision', () => {
    const p = plan(rev(120000), project());
    assert.equal(p.orderPatch.contractAmount, 120000);
    assert.equal(p.orderPatch.contractRev, 1);
    assert.equal(p.orderPatch.pendingRevision, '__DELETE__');
    const r = p.orderPatch.revisions.__union[0];
    assert.deepEqual([r.revNo, r.kind, r.fromAmount, r.toAmount, r.delta, r.decision, r.decidedByRole, r.onBehalf, r.ledgerId, r.collectedAtApply, r.arAfter, r.clientCreditAfter],
      [1, 'manual', 100000, 120000, 20000, 'confirmed', 'president', false, 'SO-ord123-R1', 65000, 55000, 0]);
    assert.equal(r.requestedByName, 'Uriel');
  });
  it('decision is "approved" for a pending_approval request, "confirmed" for pending_confirm; a stand-in is onBehalf', () => {
    const pa = plan(rev(50000, { status: 'pending_approval' }), project());
    assert.equal(pa.revision.decision, 'approved');
    const fin = plan(rev(120000), project(), { viewer: FIN, who: 'Shaira' });
    assert.equal(fin.revision.decision, 'confirmed');
    assert.equal(fin.revision.onBehalf, true);
    assert.equal(fin.revision.decidedByRole, 'finance');
    assert.equal(fin.ledgerEntry.extra.confirmedBy, 'Shaira');
  });
  it('Choice A brings items, quote and the original quote id; scope change flags the job order', () => {
    const pr = pendingRev({ kind: 'quote_revision', quoteId: 'quo2', quoteColl: 'bk_quotes', quoteNumber: 'BK-1-R2' });
    const items = [{ name: 'A' }, { name: 'B' }];
    const p = plan(order({ pendingRevision: pr }), project({ jobOrder: { items: [{ name: 'A' }] } }), { quote: { id: 'quo2', number: 'BK-1-R2', items } });
    assert.equal(p.ok, true);
    assert.deepEqual(p.projectFields.items, items);
    assert.equal(p.projectFields.quoteId, 'quo2');
    assert.equal(p.projectFields['jobOrder.scopeReviewNeeded'], true);
    assert.equal(p.orderPatch.quoteId, 'quo2');
    assert.equal(p.orderPatch.quoteIdOriginal, 'quo1');
    assert.deepEqual(p.orderPatch.items, items);
  });
  it('a price-only change does not flag the job order; same items does not either', () => {
    const p = plan(rev(120000), project({ jobOrder: { items: [{ name: 'A' }] } }));
    assert.ok(!('jobOrder.scopeReviewNeeded' in p.projectFields) && !('items' in p.projectFields) && !('quoteIdOriginal' in p.orderPatch));
    const pr = pendingRev({ kind: 'quote_revision', quoteId: 'quo2' });
    const same = plan(order({ pendingRevision: pr }), project({ jobOrder: { items: [{ name: 'A' }] } }), { quote: { id: 'quo2', number: 'N', items: [{ name: 'A' }] } });
    assert.ok(!('jobOrder.scopeReviewNeeded' in same.projectFields));
  });
  it('Choice C is a scope change', () => {
    const pr = pendingRev({ kind: 'change_order', changeOrderId: 'co1' });
    const p = plan(order({ pendingRevision: pr }), project({ jobOrder: { items: [] } }), { changeOrder: { status: 'signed', addedDownPayment: 0 } });
    assert.equal(p.projectFields['jobOrder.scopeReviewNeeded'], true);
  });
  it('delta === 0 (Choice A, same total, different items): no ledger entry at all', () => {
    const pr = pendingRev({ kind: 'quote_revision', quoteId: 'quo2', toAmount: 100000, delta: 0 });
    const p = plan(order({ pendingRevision: pr }), project(), { quote: { id: 'quo2', number: 'N', items: [{ name: 'Z' }] } });
    assert.equal(p.ok, true);
    assert.equal(p.ledgerEntry, null);
    assert.equal(p.revision.ledgerId, null);
    assert.equal(p.projectFields.contractAmount, 100000);
  });
});

// ── (9) refusals ───────────────────────────────────────────────────────────────────────────────────────────────
describe('planApply — every refusal code, nothing written (§7.4)', () => {
  const refuses = (o, p, c, code) => { const r = plan(o, p, c); assert.deepEqual([r.ok, r.code], [false, code]); assert.ok(!r.ledgerEntry && !r.orderPatch && !r.projectFields); };
  it('(9) nothing-pending', () => refuses(order({ pendingRevision: undefined }), project(), {}, 'nothing-pending'));
  it('(9) already-applied: no pendingRevision and revisions already holds the revNo', () => {
    refuses(order({ pendingRevision: undefined, contractRev: 1, revisions: [{ revNo: 1 }] }), project(), {}, 'already-applied');
    refuses(order({ pendingRevision: undefined, contractRev: 2, revisions: [{ revNo: 1 }, { revNo: 2 }] }), project(), { revNo: 2 }, 'already-applied');
    refuses(order({ pendingRevision: undefined, contractRev: 1, revisions: [{ revNo: 1 }] }), project(), { revNo: 2 }, 'nothing-pending');
  });
  it('(9) a sent-back (rejected) request cannot be applied', () => refuses(order({ pendingRevision: pendingRev({ status: 'rejected' }) }), project(), {}, 'nothing-pending'));
  it('(9) president-only: pending_approval and the actor is Finance', () => refuses(rev(50000, { status: 'pending_approval' }), project(), { viewer: FIN }, 'president-only'));
  it('(9) president-only wins over not-allowed for Sales on a pending_approval request', () => refuses(rev(50000, { status: 'pending_approval' }), project(), { viewer: SALES }, 'president-only'));
  it('(9) not-allowed: Sales; a missing viewer; Finance on their own request', () => {
    refuses(rev(120000), project(), { viewer: SALES }, 'not-allowed');
    refuses(rev(120000), project(), { viewer: undefined }, 'not-allowed');
    refuses(order({ pendingRevision: pendingRev({ requestedBy: 'u-fin' }) }), project(), { viewer: FIN }, 'not-allowed');
  });
  it('(9) the President may apply a request he filed himself', () => {
    assert.equal(plan(order({ pendingRevision: pendingRev({ requestedBy: 'u-pres' }) }), project()).ok, true);
  });
  it('(9) stale: wrong revNo (either way)', () => {
    refuses(order({ pendingRevision: pendingRev({ revNo: 2 }) }), project(), {}, 'stale');
    refuses(order({ contractRev: 1, pendingRevision: pendingRev({ revNo: 1 }) }), project(), {}, 'stale');
  });
  it('(9) stale: the contract moved since the request (> 0.005)', () => {
    refuses(order({ contractAmount: 100001 }), project(), {}, 'stale');
    assert.equal(plan(order({ contractAmount: 100000.004 }), project()).ok, true);     // within slack
  });
  it('(9) payment-not-confirmed', () => { refuses(order({ status: 'pending' }), project(), {}, 'payment-not-confirmed'); });
  it('(9) job-closed: paid and cancelled', () => {
    refuses(rev(120000), project({ stage: 'paid' }), {}, 'job-closed');
    refuses(rev(120000), project({ stage: 'cancelled' }), {}, 'job-closed');
  });
  it('(15) change-order-not-ready: unsigned change order; unconfirmed added down payment; missing doc', () => {
    const o = order({ pendingRevision: pendingRev({ kind: 'change_order', changeOrderId: 'co1' }) });
    refuses(o, project(), { changeOrder: { status: 'priced', addedDownPayment: 0 } }, 'change-order-not-ready');
    refuses(o, project(), { changeOrder: { status: 'signed', addedDownPayment: 5000, claimStatus: 'pending' } }, 'change-order-not-ready');
    refuses(o, project(), { changeOrder: { status: 'signed', addedDownPayment: 5000, claimStatus: null } }, 'change-order-not-ready');
    refuses(o, project(), {}, 'change-order-not-ready');
    assert.equal(plan(o, project(), { changeOrder: { status: 'signed', addedDownPayment: 5000, claimStatus: 'recorded' } }).ok, true);
    assert.equal(plan(o, project(), { changeOrder: { status: 'signed', addedDownPayment: 0 } }).ok, true);
  });
  it('quote-missing: Choice A without the quote read; no-project', () => {
    refuses(order({ pendingRevision: pendingRev({ kind: 'quote_revision', quoteId: 'q' }) }), project(), {}, 'quote-missing');
    refuses(rev(120000), null, {}, 'no-project');
  });
  it('the plan does not mutate its inputs', () => {
    const deep = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deep); } return v; };
    assert.equal(plan(deep(rev(120000)), deep(project())).ok, true);
  });
});

// ── runApply with fakes ────────────────────────────────────────────────────────────────────────────────────────
function makeWorld({ ord = rev(120000), proj = project(), viewer = PRES, who = 'Neil Barro', updateFailures = 0, changeOrder = null, claimStatus = null, quote = null, atomicFails = false } = {}) {
  const log = { ledgerPost: [], updateOrder: [], applyAtomic: [], afterApply: [], projectWrites: [] };
  const orders = { [ord.id]: { ...ord } };
  const state = { ...proj };
  const ledger = {};
  let failuresLeft = updateFailures;
  const deps = {
    getOrder: async (id) => (orders[id] ? { ...orders[id] } : null),
    getProject: async () => ({ ...state }),
    getChangeOrder: async () => changeOrder,
    getClaimStatus: async () => claimStatus,
    getQuote: async () => quote,
    ledgerPost: async (entry) => {
      log.ledgerPost.push(entry);
      const id = String(entry.ref).replace(/\//g, '_');
      if (ledger[id]) return { existed: true, id };
      ledger[id] = entry;
      if (entry.projectSync) { log.projectWrites.push(entry.projectSync); Object.assign(state, entry.projectSync.fields); }
      return { existed: false, id };
    },
    updateOrder: async (id, patch) => {
      log.updateOrder.push({ id, patch });
      if (failuresLeft > 0) { failuresLeft--; throw new Error('boom: updateOrder'); }
      for (const [k, v] of Object.entries(patch)) { if (v === '__DELETE__') delete orders[id][k]; else if (k === 'revisions') orders[id].revisions = [...(orders[id].revisions || []), ...v.__union]; else orders[id][k] = v; }
    },
    applyAtomic: async (a) => {
      log.applyAtomic.push(a);
      if (atomicFails) throw new Error('boom: tx');
      Object.assign(state, a.projectFields); log.projectWrites.push({ fields: a.projectFields });
      for (const [k, v] of Object.entries(a.orderPatch)) { if (v === '__DELETE__') delete orders[ord.id][k]; else if (k === 'revisions') orders[ord.id].revisions = [...(orders[ord.id].revisions || []), ...v.__union]; else orders[ord.id][k] = v; }
    },
    afterApply: async (res) => { log.afterApply.push(res); },
    sanitize: (r) => String(r).replace(/\//g, '_'),
    union: U, serverTime: () => 'SERVER_TS', deleteField: () => '__DELETE__',
    ctx: ctxOf({ viewer, who }),
  };
  return { deps, log, ledger, orders, state };
}
const noWrites = (log) => assert.deepEqual([log.ledgerPost.length, log.updateOrder.length, log.applyAtomic.length, log.projectWrites.length], [0, 0, 0, 0]);

describe('runApply (§7.4) — applies exactly once', () => {
  it('(10) happy path: ONE ledger post carrying projectSync, ONE order update', async () => {
    const w = makeWorld();
    const res = await CC.runApply('ord123', w.deps);
    assert.deepEqual(res, { ok: true, code: 'applied', revNo: 1, delta: 20000, from: 100000, to: 120000, arAfter: 55000, clientCreditAfter: 0 });
    assert.equal(w.log.ledgerPost.length, 1);
    assert.equal(w.log.updateOrder.length, 1);
    assert.equal(w.log.applyAtomic.length, 0);
    const e = w.log.ledgerPost[0];
    assert.equal(e.ref, 'SO-ord123-R1');
    assert.equal(e.amount, 20000);
    assert.equal(e.projectSync.collection, 'job_projects');
    assert.equal(e.projectSync.docId, 'prj1');
    assert.equal(e.projectSync.fields.contractAmount, 120000);
    assert.equal(e.projectSync.fields.arBalance, 55000);
    assert.equal(w.orders.ord123.contractAmount, 120000);
    assert.equal(w.orders.ord123.contractRev, 1);
    assert.equal(w.orders.ord123.pendingRevision, undefined);
    assert.equal(w.state.joRev, 1);
    assert.equal(w.log.afterApply.length, 1);
  });
  it('(10) the best-effort follow-up failing never undoes the apply', async () => {
    const w = makeWorld();
    w.deps.afterApply = async () => { throw new Error('notify failed'); };
    assert.equal((await CC.runApply('ord123', w.deps)).code, 'applied');
    assert.equal(w.orders.ord123.contractRev, 1);
  });
  it('(11) twice: the second returns already-applied; one ledger row; job changed once', async () => {
    const w = makeWorld();
    await CC.runApply('ord123', w.deps);
    const second = await CC.runApply('ord123', w.deps);
    assert.deepEqual([second.ok, second.code], [false, 'already-applied']);
    assert.equal(w.log.ledgerPost.length, 1);
    assert.equal(w.log.updateOrder.length, 1);
    assert.equal(w.log.projectWrites.length, 1);
    assert.equal(Object.keys(w.ledger).length, 1);
  });
  it('(12) updateOrder throws after the post: rejects; the retry repairs; job fields not re-sent; one ledger row', async () => {
    const w = makeWorld({ updateFailures: 1 });
    await assert.rejects(CC.runApply('ord123', w.deps), /boom: updateOrder/);
    assert.equal(w.log.projectWrites.length, 1);                 // the job moved once (in the ledger transaction)
    assert.equal(w.orders.ord123.contractRev, undefined);        // the order is not stamped yet
    const retry = await CC.runApply('ord123', w.deps);
    assert.equal(retry.code, 'repaired');
    assert.equal(w.log.projectWrites.length, 1);                 // never touched again
    assert.equal(Object.keys(w.ledger).length, 1);
    assert.equal(w.orders.ord123.contractRev, 1);
    // the retried order patch carries order fields only — none of the job's
    const jobKeys = ['arBalance', 'clientCredit', 'joRev', 'joRevAt', 'joRevNote', 'timeline', 'documents'];
    for (const u of w.log.updateOrder) for (const k of jobKeys) assert.ok(!(k in u.patch), `${k} leaked into the order patch`);
    assert.equal(w.log.updateOrder.length, 2);
    // and a third call is a clean refusal
    assert.equal((await CC.runApply('ord123', w.deps)).code, 'already-applied');
  });
  it('(13) delta === 0: no ledger call; job and order updated once, atomically', async () => {
    const pr = pendingRev({ kind: 'quote_revision', quoteId: 'quo2', quoteColl: 'bk_quotes', toAmount: 100000, delta: 0 });
    const w = makeWorld({ ord: order({ pendingRevision: pr }), quote: { quoteNumber: 'BK-1-R2', items: [{ name: 'Z' }] } });
    const res = await CC.runApply('ord123', w.deps);
    assert.equal(res.code, 'applied');
    assert.equal(w.log.ledgerPost.length, 0);
    assert.equal(w.log.updateOrder.length, 0);
    assert.equal(w.log.applyAtomic.length, 1);
    assert.equal(w.log.applyAtomic[0].projectId, 'prj1');
    assert.deepEqual(w.state.items, [{ name: 'Z' }]);
    assert.equal(w.orders.ord123.contractRev, 1);
    const again = await CC.runApply('ord123', w.deps);
    assert.equal(again.code, 'already-applied');
    assert.equal(w.log.applyAtomic.length, 1);
  });
  it('(9) refusals write nothing at all', async () => {
    const cases = [
      [{ ord: order({ pendingRevision: undefined }) }, 'nothing-pending'],
      [{ ord: rev(50000, { status: 'pending_approval' }), viewer: FIN }, 'president-only'],
      [{ viewer: SALES }, 'not-allowed'],
      [{ ord: order({ pendingRevision: pendingRev({ revNo: 3 }) }) }, 'stale'],
      [{ ord: order({ status: 'pending' }) }, 'payment-not-confirmed'],
      [{ proj: project({ stage: 'paid' }) }, 'job-closed'],
    ];
    for (const [cfg, code] of cases) {
      const w = makeWorld(cfg);
      const res = await CC.runApply('ord123', w.deps);
      assert.deepEqual([res.ok, res.code], [false, code]);
      noWrites(w.log);
    }
    const w = makeWorld();
    assert.deepEqual(await CC.runApply('nope', w.deps), { ok: false, code: 'not-found' });
    noWrites(w.log);
  });
  it('(15) Choice C: unsigned change order and unconfirmed down payment refuse with zero writes; ready applies', async () => {
    const o = order({ pendingRevision: pendingRev({ kind: 'change_order', changeOrderId: 'co1' }) });
    const unsigned = makeWorld({ ord: o, changeOrder: { status: 'priced', pricing: { addedDownPayment: 0 } } });
    assert.equal((await CC.runApply('ord123', unsigned.deps)).code, 'change-order-not-ready');
    noWrites(unsigned.log);
    const unpaid = makeWorld({ ord: o, changeOrder: { status: 'signed', pricing: { addedDownPayment: 5000 } }, claimStatus: 'pending' });
    assert.equal((await CC.runApply('ord123', unpaid.deps)).code, 'change-order-not-ready');
    noWrites(unpaid.log);
    const ready = makeWorld({ ord: o, changeOrder: { status: 'signed', pricing: { addedDownPayment: 5000 } }, claimStatus: 'recorded' });
    assert.equal((await CC.runApply('ord123', ready.deps)).code, 'applied');
  });
  it('Choice A reads the quote fresh and writes its items', async () => {
    const pr = pendingRev({ kind: 'quote_revision', quoteId: 'quo2', quoteColl: 'bk_quotes', quoteNumber: 'BK-1-R2' });
    const w = makeWorld({ ord: order({ pendingRevision: pr }), quote: { quoteNumber: 'BK-1-R2', items: [{ name: 'A' }, { name: 'B' }] } });
    assert.equal((await CC.runApply('ord123', w.deps)).code, 'applied');
    assert.deepEqual(w.state.items, [{ name: 'A' }, { name: 'B' }]);
    assert.equal(w.orders.ord123.quoteIdOriginal, 'quo1');
  });
  it('a ledger that does not say whether the row existed is an error, not a silent apply', async () => {
    const w = makeWorld();
    w.deps.ledgerPost = async () => ({});
    await assert.rejects(CC.runApply('ord123', w.deps), /did not say/);
    assert.equal(w.log.updateOrder.length, 0);
  });
  it('a decrease below collected posts a credit row and sets client credit on the job', async () => {
    const w = makeWorld({ ord: rev(50000, { status: 'pending_approval' }) });
    await CC.runApply('ord123', w.deps);
    assert.equal(w.state.clientCredit, 15000);
    assert.equal(w.state.arBalance, 0);
    assert.equal(w.log.ledgerPost[0].kind, 'credit');
    assert.equal(w.log.ledgerPost[0].amount, 50000);
  });
});

// ── (14) refund ────────────────────────────────────────────────────────────────────────────────────────────────
describe('planRefund (§7.7)', () => {
  const o = order({ contractRev: 1, pendingRevision: undefined, contractAmount: 50000 });
  const p = project({ contractAmount: 50000, amountCollected: 65000, clientCredit: 15000 });
  const rc = (over = {}) => ({ today: '2026-11-21', nowIso: '2026-11-21T01:00:00.000Z', who: 'Shaira', amount: 15000, method: 'Bank', bankTag: { ...BANK, bankFlow: 'out' }, union: U, serverTime: () => 'SERVER_TS', sanitize: (r) => r, ...over });
  it('(14) above clientCredit is refused', () => {
    assert.deepEqual(CC.planRefund(o, p, rc({ amount: 15000.01 })), { ok: false, code: 'exceeds-credit', credit: 15000 });
  });
  it('(14) equal to clientCredit: amountCollected reduced, credit 0; ref …-R<n>-RF, debit, expense', () => {
    const r = CC.planRefund(o, p, rc());
    assert.equal(r.ok, true);
    const e = r.ledgerEntry;
    assert.equal(e.ref, 'SO-ord123-R1-RF');
    assert.equal(e.kind, 'debit');
    assert.equal(e.accountType, 'expense');
    assert.equal(e.account, 'Sales Refunds');
    assert.equal(e.category, 'Sales Refunds');
    assert.equal(e.amount, 15000);
    assert.equal(e.source, 'Finance');
    assert.equal(e.description, 'Refund — Acme Foods (SO-0012 R1)');
    assert.equal(e.extra.bankAccountId, 'ba1');
    assert.equal(e.projectSync.docId, 'prj1');
    assert.equal(e.projectSync.fields.amountCollected, 50000);
    assert.equal(e.projectSync.fields.clientCredit, 0);
    assert.deepEqual(e.projectSync.fields.refunds.__union[0], { amount: 15000, date: '2026-11-21', method: 'Bank', ledgerId: 'SO-ord123-R1-RF', by: 'Shaira' });
    assert.equal(r.newCollected, 50000);
  });
  it('(14) a partial refund leaves the rest as credit', () => {
    const r = CC.planRefund(o, p, rc({ amount: 5000 }));
    assert.equal(r.ledgerEntry.projectSync.fields.amountCollected, 60000);
    assert.equal(r.ledgerEntry.projectSync.fields.clientCredit, 10000);
  });
  it('refuses a non-positive amount, an order never revised, and a job with no credit', () => {
    assert.equal(CC.planRefund(o, p, rc({ amount: 0 })).code, 'invalid-amount');
    assert.equal(CC.planRefund(o, p, rc({ amount: -5 })).code, 'invalid-amount');
    assert.equal(CC.planRefund(order({ contractRev: 0 }), p, rc()).code, 'no-revision');
    assert.equal(CC.planRefund(o, project({ contractAmount: 50000, amountCollected: 50000 }), rc({ amount: 1 })).code, 'exceeds-credit');
  });
  it('the refund is the only plan that writes amountCollected, and it never touches payments or stage', () => {
    const keys = keysDeep(CC.planRefund(o, p, rc()).ledgerEntry.projectSync.fields);
    assert.ok(!keys.includes('payments') && !keys.includes('stage'));
  });
});
