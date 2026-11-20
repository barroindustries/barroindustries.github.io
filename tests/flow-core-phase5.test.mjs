// tests/flow-core-phase5.test.mjs — js/flow-core.js, Phase 5 (specs/SALES-FLOW-SPEC-2026-11-19.md §5.6 site visits, §5.7 change orders).
//
// Pure logic, no DOM, no Firestore. MONEY-ADJACENT: the change-order price, the new contract amount, the "is the added down payment in the books"
// test (it unlocks Choice C) and the C6 budget step (half the price, once per change order) each have a test, mutation-checked (the list is in the hand-back).
//
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../js/money-core.js');
require('../js/sales-flow-core.js');
const FC = require('../js/flow-core.js');

const add = (name, qty, unitPrice, over = {}) => ({ kind: 'added', name, qty, unit: 'pc', unitPrice, ...over });
const rem = (name, qty, unitPrice, over = {}) => ({ kind: 'removed', name, qty, unit: 'pc', unitPrice, ...over });

describe('the site-visit tariff (§5.6, SF6 / SF21)', () => {
  it('is exactly 1,000 / 2,500 / 5,000 by area, and frozen', () => {
    assert.deepEqual({ ...FC.SITE_VISIT_FEE }, { mm: 1000, near: 2500, far: 5000 });
    assert.equal(Object.isFrozen(FC.SITE_VISIT_FEE), true);
    assert.equal(FC.siteVisitFee('mm'), 1000); assert.equal(FC.siteVisitFee('near'), 2500); assert.equal(FC.siteVisitFee('far'), 5000);
  });
  it('an unknown area has no fee (never a made-up one, never inherited from Object.prototype)', () => {
    for (const a of ['', 'nowhere', undefined, null, 'constructor', '__proto__', 'toString']) assert.equal(FC.siteVisitFee(a), null, String(a));
  });
  it('the three areas, in order, with the words the screens show', () => {
    assert.deepEqual(FC.SITE_VISIT_AREAS.map((a) => [a.key, a.label]), [['mm', 'Metro Manila'], ['near', 'Nearby provinces'], ['far', 'Far Luzon']]);
    assert.equal(FC.areaLabel('far'), 'Far Luzon'); assert.equal(FC.areaLabel('x'), '');
  });
});

describe('site-visit status moves', () => {
  it('requested -> fee_pending -> booked -> done, or cancelled while the fee is not confirmed', () => {
    assert.equal(FC.canVisitMove('requested', 'fee_pending'), true);
    assert.equal(FC.canVisitMove('fee_pending', 'booked'), true);
    assert.equal(FC.canVisitMove('booked', 'done'), true);
    assert.equal(FC.canVisitMove('requested', 'cancelled'), true);
    assert.equal(FC.canVisitMove('fee_pending', 'cancelled'), true);
  });
  it('a booked visit (money confirmed) cannot be cancelled; done and cancelled are final; no skipping, no going back', () => {
    assert.equal(FC.canVisitMove('booked', 'cancelled'), false);
    for (const to of ['requested', 'fee_pending', 'booked', 'done', 'cancelled']) { assert.equal(FC.canVisitMove('done', to), false); assert.equal(FC.canVisitMove('cancelled', to), false); }
    assert.equal(FC.canVisitMove('requested', 'done'), false); assert.equal(FC.canVisitMove('requested', 'booked'), false);
    assert.equal(FC.canVisitMove('booked', 'fee_pending'), false);
    assert.equal(FC.canVisitMove('nope', 'booked'), false); assert.equal(FC.canVisitMove('constructor', 'booked'), false);
  });
  it('a confirmed fee books a requested or fee_pending visit, never a cancelled or finished one', () => {
    assert.equal(FC.canBookVisit('requested'), true); assert.equal(FC.canBookVisit('fee_pending'), true);
    for (const s of ['booked', 'done', 'cancelled', '', undefined]) assert.equal(FC.canBookVisit(s), false, String(s));
  });
  it('Sales may cancel only a requested or fee_pending visit', () => {
    assert.equal(FC.canCancelVisit('requested'), true); assert.equal(FC.canCancelVisit('fee_pending'), true);
    for (const s of ['booked', 'done', 'cancelled']) assert.equal(FC.canCancelVisit(s), false, s);
  });
  it('status words are plain', () => {
    assert.deepEqual(['requested', 'fee_pending', 'booked', 'done', 'cancelled'].map(FC.visitStatusWord), ['Requested', 'Fee waiting for confirmation', 'Booked', 'Done', 'Cancelled']);
  });
});

describe('validateVisitRequest (V1)', () => {
  const good = { area: 'mm', requestedDate: '2026-11-25', address: '12 Aurora Blvd., Quezon City', contactPerson: 'Maria Santos', contactPhone: '0917 123 4567', notes: 'Gate code with the guard' };
  const run = (o, today = '2026-11-20') => FC.validateVisitRequest({ ...good, ...o }, { today });
  it('accepts a complete request and trims every field', () => {
    const r = run({ address: '  12 Aurora  ' });
    assert.equal(r.ok, true, r.error); assert.equal(r.visit.address, '12 Aurora');
  });
  it('needs an area, a real date that is not in the past, an address, a contact person and a phone', () => {
    assert.match(run({ area: '' }).error, /area/); assert.match(run({ area: 'moon' }).error, /area/);
    assert.match(run({ requestedDate: '' }).error, /date/); assert.match(run({ requestedDate: '2026-02-31' }).error, /date/); assert.match(run({ requestedDate: '25/11/2026' }).error, /date/);
    assert.match(run({ requestedDate: '2026-11-19' }).error, /past/); assert.equal(run({ requestedDate: '2026-11-20' }).ok, true, 'today is fine');
    assert.match(run({ address: ' ' }).error, /address/); assert.match(run({ contactPerson: '' }).error, /contact/); assert.match(run({ contactPhone: '12' }).error, /phone/);
  });
  it('a price in the notes is refused (the visit is money-free)', () => {
    const r = run({ notes: 'client will pay ₱5,000' });
    assert.equal(r.ok, false); assert.equal(r.error, FC.PESO_TEXT_MESSAGE);
    assert.equal(run({ address: 'PHP 500 area' }).ok, false);
  });
});

describe('validateVisitReport (V4)', () => {
  it('needs at least one of measurements, constraints, layout notes', () => {
    assert.equal(FC.validateVisitReport({}).ok, false);
    assert.equal(FC.validateVisitReport({ measurements: '   ' }).ok, false);
    for (const k of ['measurements', 'constraints', 'layoutNotes']) assert.equal(FC.validateVisitReport({ [k]: 'Wall is 3.2 m' }).ok, true, k);
  });
  it('keeps only files that have a url, with their names; a price in any text is refused', () => {
    const r = FC.validateVisitReport({ measurements: 'x', photos: [{ url: 'https://a/1.jpg', name: '1.jpg' }, { name: 'no url' }, null], attachments: [{ url: 'https://a/s.pdf' }] });
    assert.deepEqual(r.report.photos, [{ url: 'https://a/1.jpg', name: '1.jpg' }]); assert.deepEqual(r.report.attachments, [{ url: 'https://a/s.pdf', name: '' }]);
    for (const k of ['measurements', 'constraints', 'layoutNotes']) assert.equal(FC.validateVisitReport({ measurements: 'ok', [k]: 'Php 100' }).ok, false, k);
  });
});

describe('the change request is money-free (§5.7 C1)', () => {
  const ok = { details: 'Client wants a shelf under the hood', itemsAdded: [{ name: 'Shelf', qty: '2', unit: 'pc' }], itemsRemoved: [{ name: 'Table', qty: '1' }], effectOnDeadlineDays: '3' };
  it('accepts a request, drops blank rows, defaults the unit to pc and the quantity to 1, and reads the deadline days', () => {
    const r = FC.validateChangeRequest({ ...ok, itemsAdded: [...ok.itemsAdded, { name: '', qty: '' }], itemsRemoved: [{ name: 'Table', qty: '' }] });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.request.itemsAdded, [{ name: 'Shelf', qty: 2, unit: 'pc' }]); assert.deepEqual(r.request.itemsRemoved, [{ name: 'Table', qty: 1, unit: 'pc' }]);
    assert.equal(r.request.effectOnDeadlineDays, 3);
  });
  it('needs details; a row needs a name and a quantity above zero; days are a whole number', () => {
    assert.equal(FC.validateChangeRequest({ details: 'no' }).ok, false);
    assert.match(FC.validateChangeRequest({ ...ok, itemsAdded: [{ name: '', qty: '2' }] }).error, /name/);
    assert.match(FC.validateChangeRequest({ ...ok, itemsAdded: [{ name: 'Shelf', qty: '0' }] }).error, /quantity/);
    assert.match(FC.validateChangeRequest({ ...ok, itemsRemoved: [{ name: 'Table', qty: '-1' }] }).error, /quantity/);
    assert.match(FC.validateChangeRequest({ ...ok, effectOnDeadlineDays: '2.5' }).error, /whole number/); assert.match(FC.validateChangeRequest({ ...ok, effectOnDeadlineDays: 'x' }).error, /whole number/);
    assert.equal(FC.validateChangeRequest({ ...ok, effectOnDeadlineDays: '' }).request.effectOnDeadlineDays, 0);
  });
  it('a request has no price: a peso sign in the details or any row is refused, and the result has no price key at all', () => {
    for (const bad of [{ details: 'Add a shelf, ₱5,000' }, { itemsAdded: [{ name: 'Shelf ₱500', qty: '1' }] }, { itemsRemoved: [{ name: 'Table', qty: '1', unit: 'PHP' }] }]) {
      const r = FC.validateChangeRequest({ ...ok, ...bad });
      assert.equal(r.ok, false); assert.equal(r.error, FC.PESO_TEXT_MESSAGE);
    }
    const good = FC.validateChangeRequest(ok).request;
    assert.doesNotMatch(JSON.stringify(good), /price|amount|₱|pricing/i);
  });
});

describe('request status words — what Production reads, never a price (§5.7)', () => {
  it('Requested / Priced / Signed / Applied — see JO R{n} / Declined', () => {
    assert.equal(FC.requestStatusWord({ status: 'requested' }), 'Requested');
    assert.equal(FC.requestStatusWord({ status: 'priced', coNumber: 'CO-0004' }), 'Priced');
    assert.equal(FC.requestStatusWord({ status: 'signed' }), 'Signed');
    assert.equal(FC.requestStatusWord({ status: 'applied', appliedContractRev: 2 }), 'Applied — see JO R2');
    assert.equal(FC.requestStatusWord({ status: 'applied' }), 'Applied');
    assert.equal(FC.requestStatusWord({ status: 'declined' }), 'Declined');
  });
  it('the words never say "Rev." (owner SF23: R1 style) and carry no peso', () => {
    for (const s of ['requested', 'priced', 'signed', 'applied', 'declined']) assert.doesNotMatch(FC.requestStatusWord({ status: s, appliedContractRev: 3, coNumber: 'CO-1' }), /Rev\.|₱/);
  });
});

describe('request and change-order moves', () => {
  it('requested -> priced | declined; priced -> signed | declined; signed -> applied; nothing leaves applied or declined', () => {
    assert.equal(FC.canRequestMove('requested', 'priced'), true); assert.equal(FC.canRequestMove('requested', 'declined'), true);
    assert.equal(FC.canRequestMove('priced', 'signed'), true); assert.equal(FC.canRequestMove('priced', 'declined'), true);
    assert.equal(FC.canRequestMove('signed', 'applied'), true);
    assert.equal(FC.canRequestMove('requested', 'signed'), false); assert.equal(FC.canRequestMove('requested', 'applied'), false);
    assert.equal(FC.canRequestMove('signed', 'declined'), false, 'a signed change order cannot be declined');
    for (const to of ['requested', 'priced', 'signed', 'applied', 'declined']) { assert.equal(FC.canRequestMove('applied', to), false); assert.equal(FC.canRequestMove('declined', to), false); }
  });
  it('pricing: a requested one, or a priced one whose change order is not yet signed (re-pricing); never signed, applied or declined', () => {
    assert.equal(FC.canPriceRequest('requested', undefined), true); assert.equal(FC.canPriceRequest('requested', 'priced'), true, 'repair after a half-written price');
    assert.equal(FC.canPriceRequest('priced', 'priced'), true); assert.equal(FC.canPriceRequest('priced', undefined), true);
    for (const r of ['signed', 'applied', 'declined']) assert.equal(FC.canPriceRequest(r, 'priced'), false, r);
    assert.equal(FC.canPriceRequest('priced', 'signed'), false); assert.equal(FC.canPriceRequest('priced', 'applied'), false);
  });
  it('signing needs a priced change order; declining a requested or priced request', () => {
    assert.equal(FC.canSignOrder('priced'), true);
    for (const s of ['signed', 'applied', 'declined', undefined]) assert.equal(FC.canSignOrder(s), false, String(s));
    assert.equal(FC.canDeclineRequest('requested'), true); assert.equal(FC.canDeclineRequest('priced'), true);
    for (const s of ['signed', 'applied', 'declined']) assert.equal(FC.canDeclineRequest(s), false, s);
  });
});

describe('priceChangeOrder — price = Σ added − Σ removed (§5.7 C2) [MONEY]', () => {
  const price = (lines, dp) => FC.priceChangeOrder({ lines, addedDownPayment: dp });
  it('adds the added lines and takes the removed lines off', () => {
    const r = price([add('Shelf', 2, 1500), add('Hook', 3, 100), rem('Table', 1, 500)], 1000);
    assert.equal(r.ok, true, r.error); assert.equal(r.price, 2800); assert.equal(r.addedDownPayment, 1000);
  });
  it('the price may be negative (only items removed) or zero; each line keeps its kind', () => {
    const neg = price([rem('Table', 2, 2500)]);
    assert.equal(neg.ok, true, neg.error); assert.equal(neg.price, -5000); assert.equal(neg.addedDownPayment, 0);
    const zero = price([add('Shelf', 1, 800), rem('Rack', 1, 800)]);
    assert.equal(zero.ok, true); assert.equal(zero.price, 0);
    assert.deepEqual(price([add('A', 1, 1), rem('B', 1, 1)]).lines.map((l) => l.kind), ['added', 'removed']);
  });
  it('rounds to the centavo; line amounts are signed', () => {
    assert.equal(price([add('Part', 3, 33.33)]).price, 99.99);
    assert.equal(price([add('Cable', 2.5, 10.1)]).price, 25.25, 'a fractional quantity and a binary-float product still land on the centavo');
    assert.equal(price([add('Part', 1, 10.005)]).lines[0].unitPrice, 10.01, 'the unit price is held to the centavo');
    assert.equal(FC.lineAmount(add('A', 2, 1250.5)), 2501); assert.equal(FC.lineAmount(rem('A', 2, 1250.5)), -2501);
  });
  it('needs a line; a name, a quantity above zero and a unit price of 0 or more on every filled row; blank rows are ignored', () => {
    assert.match(price([]).error, /at least one line/); assert.match(price([{ kind: 'added', name: '', qty: '', unitPrice: '' }]).error, /at least one line/);
    assert.match(price([add('', 1, 5)]).error, /name/);
    assert.match(price([add('Shelf', 0, 5)]).error, /quantity/); assert.match(price([add('Shelf', 'x', 5)]).error, /quantity/);
    assert.match(price([add('Shelf', 1, -5)]).error, /unit price/); assert.match(price([add('Shelf', 1, '')]).error, /unit price/);
    assert.equal(price([add('Shelf', 1, 5), { kind: 'added', name: '', qty: '', unitPrice: '' }]).ok, true);
  });
  it('the added down payment is 0 or more, only on a price that rises, and never more than the price', () => {
    assert.equal(price([add('Shelf', 1, 1000)], 1000).ok, true, 'equal to the price is fine');
    assert.match(price([add('Shelf', 1, 1000)], 1000.01).error, /more than the price/);
    assert.match(price([add('Shelf', 1, 1000)], -1).error, /0 or more/);
    assert.match(price([rem('Table', 1, 100)], 50).error, /raises the price/); assert.match(price([add('A', 1, 5), rem('B', 1, 5)], 1).error, /raises the price/);
    assert.equal(price([add('Shelf', 1, 1000)], '').addedDownPayment, 0);
  });
  it('a bare lines array and a missing argument never throw', () => {
    assert.equal(FC.priceChangeOrder().ok, false); assert.equal(FC.priceChangeOrder({}).ok, false); assert.equal(FC.priceChangeOrder({ lines: null }).ok, false);
  });
});

describe('changeOrderTotals — the new contract amount (§5.7, change_order form) [MONEY]', () => {
  it('before it is applied: current contract + price (a negative price lowers it)', () => {
    assert.deepEqual(FC.changeOrderTotals({ contractNow: 100000, price: 20000 }), { before: 100000, price: 20000, after: 120000, applied: false });
    assert.equal(FC.changeOrderTotals({ contractNow: 100000, price: -5000 }).after, 95000);
  });
  it('once applied the contract already holds the price: the revision\'s own from / to are printed, never price twice', () => {
    const t = FC.changeOrderTotals({ contractNow: 120000, price: 20000, appliedRevision: { fromAmount: 100000, toAmount: 120000 } });
    assert.deepEqual(t, { before: 100000, price: 20000, after: 120000, applied: true });
  });
  it('a revision with no figures is ignored (falls back to current + price)', () => {
    assert.equal(FC.changeOrderTotals({ contractNow: 100, price: 5, appliedRevision: {} }).after, 105);
  });
});

describe('claimStatusFor — is the added down payment in the books? (unlocks Choice C) [MONEY]', () => {
  const rec = (n, o = {}) => ({ status: 'recorded', recordedAmount: n, ...o });
  it('recorded when the confirmed amounts reach the added down payment', () => {
    assert.equal(FC.claimStatusFor(10000, [rec(10000)]), 'recorded');
    assert.equal(FC.claimStatusFor(10000, [rec(6000), rec(4000)]), 'recorded', 'two payments add up');
    assert.equal(FC.claimStatusFor(10000, [rec(11200)]), 'recorded', 'a VAT-exclusive payment books more than was entered');
    assert.equal(FC.claimStatusFor(10000, [rec(9999.996)]), 'recorded', 'within half a centavo');
  });
  it('partial when something is confirmed but less than asked', () => {
    assert.equal(FC.claimStatusFor(10000, [rec(4000)]), 'partial');
    assert.equal(FC.claimStatusFor(10000, [rec(9999.99)]), 'partial');
  });
  it('pending while a claim waits; sent back when that is all there is; null with no claim', () => {
    assert.equal(FC.claimStatusFor(10000, [{ status: 'pending' }]), 'pending');
    assert.equal(FC.claimStatusFor(10000, [rec(4000), { status: 'pending' }]), 'pending');
    assert.equal(FC.claimStatusFor(10000, [{ status: 'payment_rejected' }]), 'payment_rejected');
    assert.equal(FC.claimStatusFor(10000, []), null); assert.equal(FC.claimStatusFor(10000, null), null);
  });
  it('a pending or sent-back claim never counts as money', () => {
    assert.equal(FC.claimStatusFor(10000, [{ status: 'pending', recordedAmount: 10000 }, { status: 'payment_rejected', recordedAmount: 10000 }]), 'pending');
  });
  it('a recorded claim of 0 does not unlock anything', () => {
    assert.notEqual(FC.claimStatusFor(10000, [rec(0)]), 'recorded');
  });
});

describe('planBudgetAdd — C6: budget.changeOrderAdds += 0.5 × price, once per change order [MONEY]', () => {
  it('half the price is added (the share is 0.5)', () => {
    assert.equal(FC.CHANGE_ORDER_BUDGET_SHARE, 0.5);
    const p = FC.planBudgetAdd(null, { changeOrderId: 'co1', price: 20000 });
    assert.equal(p.skip, false); assert.equal(p.add, 10000); assert.equal(p.budget.changeOrderAdds, 10000); assert.deepEqual(p.budget.coApplied, ['co1']);
  });
  it('a negative price lowers the adds (SF20 — the mirror of S12)', () => {
    const p = FC.planBudgetAdd({ budget: { changeOrderAdds: 3000 } }, { changeOrderId: 'co2', price: -5000 });
    assert.equal(p.add, -2500); assert.equal(p.budget.changeOrderAdds, 500);
    assert.equal(FC.planBudgetAdd(null, { changeOrderId: 'co2', price: -5000 }).budget.changeOrderAdds, -2500);
  });
  it('adds on top of what is there, keeps every other budget key, and counts centavos', () => {
    const p = FC.planBudgetAdd({ budget: { base: 60000, changeOrderAdds: 1000, source: 'typed', setBy: 'Neil' } }, { changeOrderId: 'co3', price: 1001 });
    assert.equal(p.budget.changeOrderAdds, 1500.5); assert.equal(p.budget.base, 60000); assert.equal(p.budget.source, 'typed'); assert.equal(p.budget.setBy, 'Neil');
  });
  it('the same change order is counted once: a second run adds nothing', () => {
    const first = FC.planBudgetAdd(null, { changeOrderId: 'co1', price: 20000 });
    const second = FC.planBudgetAdd({ budget: first.budget }, { changeOrderId: 'co1', price: 20000 });
    assert.deepEqual({ skip: second.skip, reason: second.reason }, { skip: true, reason: 'already-counted' });
    const other = FC.planBudgetAdd({ budget: first.budget }, { changeOrderId: 'co9', price: 2000 });
    assert.equal(other.budget.changeOrderAdds, 11000); assert.deepEqual(other.budget.coApplied, ['co1', 'co9']);
  });
  it('total follows only when a base is set (base + adds); with no base it is left alone', () => {
    assert.equal(FC.planBudgetAdd({ budget: { base: 100000, total: 100000 } }, { changeOrderId: 'c', price: 20000 }).budget.total, 110000);
    assert.equal(FC.planBudgetAdd({ budget: { base: 0 } }, { changeOrderId: 'c', price: 2000 }).budget.total, 1000);
    assert.ok(!('total' in FC.planBudgetAdd(null, { changeOrderId: 'c', price: 20000 }).budget));
    assert.ok(!('total' in FC.planBudgetAdd({ budget: { base: null } }, { changeOrderId: 'c', price: 20000 }).budget));
  });
  it('a missing id or a non-number price is skipped (nothing written)', () => {
    assert.equal(FC.planBudgetAdd(null, { price: 5 }).skip, true); assert.equal(FC.planBudgetAdd(null, { changeOrderId: 'c', price: 'x' }).skip, true);
    assert.equal(FC.planBudgetAdd(null, { changeOrderId: 'c', price: undefined }).skip, true); assert.equal(FC.planBudgetAdd(null, {}).skip, true);
  });
  it('a zero price still records the change order as counted, with a zero add', () => {
    const p = FC.planBudgetAdd(null, { changeOrderId: 'c', price: 0 });
    assert.equal(p.skip, false); assert.equal(p.add, 0); assert.deepEqual(p.budget.coApplied, ['c']);
  });
  it('does not touch its input', () => {
    const doc = { budget: { base: 1, changeOrderAdds: 2, coApplied: ['a'] } };
    FC.planBudgetAdd(doc, { changeOrderId: 'b', price: 10 });
    assert.deepEqual(doc, { budget: { base: 1, changeOrderAdds: 2, coApplied: ['a'] } });
  });
});

describe('pesoInText', () => {
  it('finds a peso sign, PHP or Php in strings, arrays and nested objects; clean text passes', () => {
    assert.equal(FC.pesoInText('pay ₱5'), true); assert.equal(FC.pesoInText('PHP 5'), true); assert.equal(FC.pesoInText('Php5'), true);
    assert.equal(FC.pesoInText('a', ['b', { c: 'x ₱' }]), true); assert.equal(FC.pesoInText({ a: { b: ['PHP'] } }), true);
    assert.equal(FC.pesoInText('a clean note', ['two', { three: 3 }], null, undefined, 4), false);
  });
});
