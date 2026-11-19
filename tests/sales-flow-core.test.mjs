// tests/sales-flow-core.test.mjs — WP1 of specs/SALES-QUICK-FIXES-SPEC-2026-11-19.md (§4, §10, §14.2, §14.6).
//
// js/sales-flow-core.js is the pure core of the Sales flow: Mark sent / Lost, Record payment, the President's one-tap
// confirmation (and Finance as his stand-in), the order state badge and the Generate gate. This is MONEY logic: every
// rule below is mutation-tested (the mutation list is in the WP1 commit message; M1-M11 are the spec's, the rest are extras).
//
// Loads js/money-core.js first (the core reads window.vatSplit), then js/sales-flow-core.js, exactly as index.html does.
//
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../js/money-core.js');
const SF = require('../js/sales-flow-core.js');
const SOURCE = fs.readFileSync(new URL('../js/sales-flow-core.js', import.meta.url), 'utf8');

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────
const PRES = { uid: 'u-pres', isPresident: true, isFinanceTier: false };
const FIN = { uid: 'u-fin', isPresident: false, isFinanceTier: true };
const SALES = { uid: 'u-sales', isPresident: false, isFinanceTier: false };
const BANK = { bankAccountId: 'ba1', bankAccountName: 'BDO Main (•••• 7890)' };

const order = (over = {}) => ({
  id: 'ord123', quoteId: 'quo999', quoteNumber: 'BK-260101-001', clientName: 'Acme Foods', projectId: 'prj1',
  flowVersion: 2, status: 'pending', contractAmount: 100000, paymentReceived: 65000, paymentMethod: 'GCash',
  vatTreatment: 'inclusive', orRef: 'OR-77', paymentDate: '2026-11-18', receiptUrl: 'https://r.example/1',
  createdBy: 'u-sales', createdByName: 'Uriel', trackingToken: 'tok1',
  paymentConfirm: { requestedAt: '2026-11-18T01:00:00.000Z', requestedBy: 'u-sales', requestedByName: 'Uriel', decision: null, resubmits: 0 },
  ...over,
});
const project = (over = {}) => ({ id: 'prj1', amountCollected: 0, contractAmount: 100000, ...over });
const ctxOf = (over = {}) => ({
  today: '2026-11-19', nowIso: '2026-11-19T02:00:00.000Z', who: 'Neil Barro', whoUid: 'u-pres',
  acct: BANK, bankTag: { ...BANK, bankFlow: 'in' }, viewer: PRES, sanitize: (r) => String(r).replace(/\//g, '_'), ...over,
});
const keysDeep = (v, acc = []) => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, acc));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.push(k); keysDeep(x, acc); }
  return acc;
};
const deepFreeze = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); } return v; };

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the module itself', () => {
  it('exposes exactly the documented members (§4 + the two A1 additions) and nothing else', () => {
    assert.deepEqual(Object.keys(SF).sort(), [
      'LOST_REASONS', 'ORDER_STATE_META', 'canConfirmPayment', 'canGenerate', 'canMarkLost', 'canMarkSent', 'canReopenLost',
      'decisionStamp', 'dpPercentOf', 'hasHandoffDrawing', 'lostReasonLabel', 'orderState', 'planConfirmation', 'quoteTotal',
      'runConfirmation', 'salesMayEditPayment', 'transferBlockReason', 'validateLost', 'validatePayment',
    ]);
    assert.equal(globalThis.window.SalesFlow, SF);
  });
  it('keeps the file contract: shim on line 1, module.exports at the end, no DOM / Firestore / clock', () => {
    assert.equal(SOURCE.split('\n')[0], "if (typeof window === 'undefined') globalThis.window = globalThis;");
    assert.ok(/if \(typeof module !== 'undefined' && module\.exports\) module\.exports = window\.SalesFlow;\s*$/.test(SOURCE));
    for (const banned of ['document.', 'firebase', 'db.collection', 'Date.now', 'new Date(', 'localStorage', 'innerHTML']) {
      assert.ok(!SOURCE.includes(banned), `the core must stay pure, but mentions ${banned}`);
    }
  });
  it('never names a BIR receipt or an invoice: nothing the app writes for a payment may carry those titles', () => {
    assert.ok(!/Official Receipt/i.test(SOURCE) && !/Sales Invoice/i.test(SOURCE));
  });
});

describe('LOST_REASONS, lostReasonLabel, validateLost (§3.4, §5.1)', () => {
  it('lists the seven reasons, exact codes and labels, in order', () => {
    assert.deepEqual(SF.LOST_REASONS.map((r) => [r.code, r.label]), [
      ['price', 'Price'], ['timing', 'Timing'], ['competitor', 'Went with a competitor'], ['no_response', 'No response'],
      ['cancelled', 'Project cancelled'], ['budget', 'Budget not approved'], ['other', 'Other (note required)'],
    ]);
  });
  it('is frozen, entries included', () => {
    assert.ok(Object.isFrozen(SF.LOST_REASONS) && SF.LOST_REASONS.every((r) => Object.isFrozen(r)));
  });
  it('lostReasonLabel returns the label, or an empty string for an unknown code', () => {
    assert.equal(SF.lostReasonLabel('competitor'), 'Went with a competitor');
    for (const bad of ['', 'nope', undefined, null, 'constructor', 'PRICE']) assert.equal(SF.lostReasonLabel(bad), '');
  });
  it('an unknown or missing code is refused first', () => {
    for (const bad of ['', 'nope', undefined, null, 'Price']) assert.equal(SF.validateLost(bad, 'a note'), 'Choose a reason.');
  });
  it('"Other" needs a note (an empty or whitespace-only note does not count)', () => {
    for (const n of ['', '   ', undefined, null, '\n\t']) assert.equal(SF.validateLost('other', n), 'Add a note for "Other".');
  });
  it('"Other" with a note is valid; any other reason is valid without one', () => {
    assert.equal(SF.validateLost('other', 'client went abroad'), '');
    for (const r of SF.LOST_REASONS.filter((x) => x.code !== 'other')) assert.equal(SF.validateLost(r.code, ''), '', r.code);
    assert.equal(SF.validateLost('price', undefined), '');
  });
  it('a note over 300 characters is refused, 300 is fine, and the length is judged on the trimmed note', () => {
    assert.equal(SF.validateLost('price', 'x'.repeat(301)), 'Keep the note under 300 characters.');
    assert.equal(SF.validateLost('other', 'x'.repeat(301)), 'Keep the note under 300 characters.');
    assert.equal(SF.validateLost('price', 'x'.repeat(300)), '');
    assert.equal(SF.validateLost('price', '  ' + 'x'.repeat(300) + '  '), '');
  });
  it('the unknown-code error wins over a too-long note, and the Other-note error over nothing else', () => {
    assert.equal(SF.validateLost('zzz', 'x'.repeat(500)), 'Choose a reason.');
    assert.equal(SF.validateLost('other', ''), 'Add a note for "Other".');
  });
});

describe('quoteTotal (same chain as the quote list)', () => {
  it('takes total, else grandTotal, else amount, else 0', () => {
    assert.equal(SF.quoteTotal({ total: 100, grandTotal: 200, amount: 300 }), 100);
    assert.equal(SF.quoteTotal({ total: 0, grandTotal: 200, amount: 300 }), 200);
    assert.equal(SF.quoteTotal({ grandTotal: '', amount: '300.5' }), 300.5);
    assert.equal(SF.quoteTotal({}), 0);
    assert.equal(SF.quoteTotal(null), 0);
    assert.equal(SF.quoteTotal({ total: 'abc' }), 0);
  });
});

describe('canMarkSent / canMarkLost / canReopenLost (truth tables)', () => {
  const q = (over = {}) => ({ status: 'filed', ...over });
  it('Mark sent: only a filed or approved quote with no order, not already sent, not superseded', () => {
    for (const s of ['filed', 'approved']) assert.equal(SF.canMarkSent(q({ status: s }), false), true, s);
    for (const s of ['draft', 'pending_approval', 'needs_revision', 'rejected', 'accepted', 'won', 'sent', 'lost', undefined]) {
      assert.equal(SF.canMarkSent(q({ status: s }), false), false, String(s));
    }
    assert.equal(SF.canMarkSent(q(), true), false, 'superseded');
    assert.equal(SF.canMarkSent(q({ salesOrderId: 'so1' }), false), false, 'already ordered');
    assert.equal(SF.canMarkSent(q({ sentAt: { seconds: 1 } }), false), false, 'already sent');
    assert.equal(SF.canMarkSent(null, false), false);
    assert.equal(SF.canMarkSent(q(), undefined), true, 'superseded is optional');
  });
  it('Lost: filed, approved, accepted or legacy-sent; never when ordered or superseded; a Sent stamp does not block it', () => {
    for (const s of ['filed', 'approved', 'accepted', 'sent']) assert.equal(SF.canMarkLost(q({ status: s }), false), true, s);
    for (const s of ['draft', 'pending_approval', 'needs_revision', 'rejected', 'won', 'lost', undefined]) assert.equal(SF.canMarkLost(q({ status: s }), false), false, String(s));
    assert.equal(SF.canMarkLost(q(), true), false, 'superseded');
    assert.equal(SF.canMarkLost(q({ salesOrderId: 'so1' }), false), false, 'already ordered');
    assert.equal(SF.canMarkLost(q({ sentAt: { seconds: 1 } }), false), true, 'a sent quote can still be lost');
    assert.equal(SF.canMarkLost(null, false), false);
  });
  it('Reopen: only a lost quote with no order (a rejected quote has no Reopen)', () => {
    assert.equal(SF.canReopenLost({ status: 'lost' }), true);
    assert.equal(SF.canReopenLost({ status: 'lost', salesOrderId: 'so1' }), false);
    for (const s of ['rejected', 'filed', 'won', undefined]) assert.equal(SF.canReopenLost({ status: s }), false, String(s));
    assert.equal(SF.canReopenLost(null), false);
  });
});

describe('validatePayment (§4, §5.2 step b)', () => {
  const ok = (over = {}) => SF.validatePayment({ contract: 100000, entered: 65000, vatTreatment: 'inclusive', hasReceipt: true, ...over });
  it('an inclusive 65,000 on a 100,000 contract records 65,000 (net 58,035.71, VAT 6,964.29)', () => {
    assert.deepEqual(ok(), { ok: true, error: '', recorded: 65000, net: 58035.71, vat: 6964.29 });
  });
  it('an exclusive 100,000 on a 100,000 contract is the VAT foot-gun: recorded 112,000, refused as over the contract', () => {
    const r = ok({ entered: 100000, vatTreatment: 'exclusive' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'The payment is more than the contract amount.');
    assert.equal(r.recorded, 112000);
    assert.equal(r.net, 100000);
    assert.equal(r.vat, 12000);
  });
  it('an exclusive amount that fits once VAT is added is accepted (recorded = amount + 12%)', () => {
    const r = SF.validatePayment({ contract: 120000, entered: 100000, vatTreatment: 'exclusive', hasReceipt: true });
    assert.deepEqual(r, { ok: true, error: '', recorded: 112000, net: 100000, vat: 12000 });
  });
  it('VAT-exempt records the amount with no VAT', () => {
    assert.deepEqual(ok({ vatTreatment: 'exempt' }), { ok: true, error: '', recorded: 65000, net: 65000, vat: 0 });
  });
  it('an unknown or missing treatment behaves as inclusive (what vatSplit does)', () => {
    assert.deepEqual(ok({ vatTreatment: undefined }), ok());
    assert.deepEqual(ok({ vatTreatment: 'weird' }), ok());
  });
  it('exactly contract + 0.50 is accepted; contract + 0.51 is refused (50 centavos of slack, no more)', () => {
    assert.equal(ok({ entered: 100000.5 }).ok, true);
    assert.equal(ok({ entered: 100000.51 }).ok, false);
    assert.equal(ok({ entered: 100000.51 }).error, 'The payment is more than the contract amount.');
    assert.equal(ok({ entered: 100001 }).ok, false);
    assert.equal(ok({ entered: 100000 }).ok, true, 'paying the whole contract is fine');
  });
  it('the 50-centavo slack is not tipped by binary floating point on awkward contracts', () => {
    assert.equal(SF.validatePayment({ contract: 12345.67, entered: 12346.17, vatTreatment: 'inclusive', hasReceipt: true }).ok, true);
    assert.equal(SF.validatePayment({ contract: 12345.67, entered: 12346.18, vatTreatment: 'inclusive', hasReceipt: true }).ok, false);
    assert.equal(SF.validatePayment({ contract: 0.1 + 0.2, entered: 0.8, vatTreatment: 'inclusive', hasReceipt: true }).ok, true);
  });
  it('zero, negative, missing and non-numeric amounts are refused: "Enter the amount the client paid."', () => {
    for (const e of [0, -5, -0.01, undefined, null, '', 'abc', NaN]) {
      const r = ok({ entered: e });
      assert.equal(r.ok, false, String(e));
      assert.equal(r.error, 'Enter the amount the client paid.', String(e));
      assert.equal(r.recorded, 0, 'the summary card shows 0, not NaN');
    }
  });
  it('a contract of zero, negative or missing is refused first: the quote has no total', () => {
    for (const c of [0, -1, undefined, null, '', NaN]) {
      const r = ok({ contract: c });
      assert.equal(r.error, 'This quote has no total, so a payment cannot be recorded against it.', String(c));
    }
  });
  it('a missing receipt is refused: "Attach the receipt or proof of payment."', () => {
    for (const h of [false, undefined, null, 0, '']) assert.equal(ok({ hasReceipt: h }).error, 'Attach the receipt or proof of payment.', String(h));
  });
  it('errors come in the documented order: no total, then no amount, then over-contract, then no receipt', () => {
    assert.equal(ok({ contract: 0, entered: 0, hasReceipt: false }).error, 'This quote has no total, so a payment cannot be recorded against it.');
    assert.equal(ok({ entered: 0, hasReceipt: false }).error, 'Enter the amount the client paid.');
    assert.equal(ok({ entered: 500000, hasReceipt: false }).error, 'The payment is more than the contract amount.');
    assert.equal(ok({ hasReceipt: false }).error, 'Attach the receipt or proof of payment.');
  });
  it('the live-summary numbers are returned even when the result is an error', () => {
    const r = ok({ entered: 500000, hasReceipt: false });
    assert.equal(r.ok, false);
    assert.equal(r.recorded, 500000);
    assert.equal(r.net, 446428.57);
    assert.equal(r.vat, 53571.43);
  });
  it('accepts numeric strings (an input value) the way the form passes them', () => {
    assert.equal(SF.validatePayment({ contract: '100000', entered: '65000', vatTreatment: 'inclusive', hasReceipt: true }).recorded, 65000);
  });
});

describe('dpPercentOf', () => {
  it('is the payment as a share of the contract, one decimal; null with no contract', () => {
    assert.equal(SF.dpPercentOf(65000, 100000), 65);
    assert.equal(SF.dpPercentOf(33333, 100000), 33.3);
    assert.equal(SF.dpPercentOf(1, 3), 33.3);
    assert.equal(SF.dpPercentOf(0, 100000), 0);
    for (const c of [0, -5, undefined, null, NaN]) assert.equal(SF.dpPercentOf(50, c), null, String(c));
  });
});

describe('orderState + ORDER_STATE_META (§3.5)', () => {
  it('walks all six rows', () => {
    assert.equal(SF.orderState({ sentToProduction: true }), 'in_production');
    assert.equal(SF.orderState({ sentToDesign: true }), 'in_design');
    assert.equal(SF.orderState({ status: 'recorded' }), 'confirmed');
    assert.equal(SF.orderState({ status: 'payment_rejected' }), 'rejected');
    assert.equal(SF.orderState({ flowVersion: 2, status: 'pending' }), 'awaiting_confirmation');
    assert.equal(SF.orderState({ status: 'pending' }), 'legacy_pending');
  });
  it('the first match wins: production over design over confirmed; recorded beats flow 2; rejected beats flow 2', () => {
    assert.equal(SF.orderState({ sentToProduction: true, sentToDesign: true, status: 'recorded', flowVersion: 2 }), 'in_production');
    assert.equal(SF.orderState({ sentToDesign: true, status: 'recorded', flowVersion: 2 }), 'in_design');
    assert.equal(SF.orderState({ status: 'recorded', flowVersion: 2 }), 'confirmed', 'a confirmed flow-2 order is confirmed, not awaiting');
    assert.equal(SF.orderState({ status: 'payment_rejected', flowVersion: 2 }), 'rejected');
    assert.equal(SF.orderState({ status: 'recorded', autoRecorded: true }), 'confirmed', 'legacy auto-recorded orders read as confirmed');
  });
  it('a flow-2 order with no status yet, or any unknown shape, is never "confirmed"', () => {
    assert.equal(SF.orderState({ flowVersion: 2 }), 'awaiting_confirmation');
    assert.equal(SF.orderState({}), 'legacy_pending');
    assert.equal(SF.orderState(null), 'legacy_pending');
    assert.equal(SF.orderState(undefined), 'legacy_pending');
    assert.equal(SF.orderState({ flowVersion: 1, status: 'pending' }), 'legacy_pending');
  });
  it('ORDER_STATE_META gives the badge class and text of §3.5 (A1: "Awaiting confirmation")', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(SF.ORDER_STATE_META).map(([k, v]) => [k, [v.cls, v.label]])), {
      in_production: ['badge-blue', 'In production'],
      in_design: ['badge-purple', 'In design'],
      confirmed: ['badge-green', 'Payment confirmed'],
      rejected: ['badge-red', 'Payment rejected'],
      awaiting_confirmation: ['badge-orange', 'Awaiting confirmation'],
      legacy_pending: ['badge-orange', 'pending'],
    });
    assert.ok(Object.isFrozen(SF.ORDER_STATE_META));
  });
  it('every state orderState can return has a badge', () => {
    for (const o of [{ sentToProduction: 1 }, { sentToDesign: 1 }, { status: 'recorded' }, { status: 'payment_rejected' }, { flowVersion: 2 }, {}]) {
      assert.ok(SF.ORDER_STATE_META[SF.orderState(o)]);
    }
  });
});

describe('salesMayEditPayment / canGenerate / transferBlockReason / hasHandoffDrawing', () => {
  it('Sales may edit a flow-2 payment only until it is confirmed (a rejected one included)', () => {
    assert.equal(SF.salesMayEditPayment({ flowVersion: 2, status: 'pending' }), true);
    assert.equal(SF.salesMayEditPayment({ flowVersion: 2, status: 'payment_rejected' }), true);
    assert.equal(SF.salesMayEditPayment({ flowVersion: 2, status: 'recorded' }), false);
    assert.equal(SF.salesMayEditPayment({ status: 'pending' }), false, 'a legacy order has no Sales edit');
    assert.equal(SF.salesMayEditPayment(null), false);
  });
  it('Generate: a confirmed order that nobody has sent on', () => {
    assert.equal(SF.canGenerate({ status: 'recorded' }), true);
    assert.equal(SF.canGenerate({ status: 'recorded', flowVersion: 2 }), true);
    assert.equal(SF.canGenerate({ status: 'recorded', sentToDesign: true }), false);
    assert.equal(SF.canGenerate({ status: 'recorded', sentToProduction: true }), false);
    for (const s of ['pending', 'payment_rejected', undefined]) assert.equal(SF.canGenerate({ status: s, flowVersion: 2 }), false, String(s));
    assert.equal(SF.canGenerate(null), false);
  });
  it('the hand-off block reason: flow-2 orders only, until confirmed (A1 wording)', () => {
    assert.equal(SF.transferBlockReason({ flowVersion: 2, status: 'pending' }), 'The payment has not been confirmed yet.');
    assert.equal(SF.transferBlockReason({ flowVersion: 2, status: 'payment_rejected' }), 'The payment has not been confirmed yet.');
    assert.equal(SF.transferBlockReason({ flowVersion: 2, status: 'recorded' }), '');
    assert.equal(SF.transferBlockReason({ status: 'pending' }), '', 'a legacy order is never blocked here');
    assert.equal(SF.transferBlockReason({}), '');
    assert.equal(SF.transferBlockReason(null), '');
  });
  it('a hand-off drawing counts only with a url', () => {
    assert.equal(SF.hasHandoffDrawing({ handoffDrawing: { url: 'https://x/d.pdf' } }), true);
    assert.equal(SF.hasHandoffDrawing({ handoffDrawing: { url: '' } }), false);
    assert.equal(SF.hasHandoffDrawing({ handoffDrawing: {} }), false);
    assert.equal(SF.hasHandoffDrawing({ handoffDrawing: null }), false);
    assert.equal(SF.hasHandoffDrawing({}), false);
    assert.equal(SF.hasHandoffDrawing(null), false);
  });
});

describe('canConfirmPayment (§14.2.1, owner ruling F2)', () => {
  const o = (createdBy) => ({ id: 'o1', createdBy });
  it('the President may confirm anything, including the order he recorded himself', () => {
    assert.equal(SF.canConfirmPayment(o('u-sales'), PRES), true);
    assert.equal(SF.canConfirmPayment(o('u-pres'), PRES), true);
  });
  it('a finance-tier user may stand in for an order somebody else recorded', () => {
    assert.equal(SF.canConfirmPayment(o('u-sales'), FIN), true);
    assert.equal(SF.canConfirmPayment(o('u-pres'), FIN), true);
  });
  it('a finance-tier user may NOT confirm a payment they recorded themselves', () => {
    assert.equal(SF.canConfirmPayment(o('u-fin'), FIN), false);
  });
  it('anyone else may not, whoever recorded it', () => {
    assert.equal(SF.canConfirmPayment(o('u-sales'), SALES), false);
    assert.equal(SF.canConfirmPayment(o('u-other'), SALES), false);
    assert.equal(SF.canConfirmPayment(o('u-sales'), { uid: 'u-mgr', isPresident: false, isFinanceTier: false }), false, 'a manager outside Finance is not a stand-in');
  });
  it('a missing order or viewer is no', () => {
    assert.equal(SF.canConfirmPayment(undefined, PRES), false);
    assert.equal(SF.canConfirmPayment(null, FIN), false);
    assert.equal(SF.canConfirmPayment(o('u-sales'), undefined), false);
    assert.equal(SF.canConfirmPayment(o('u-sales'), null), false);
    assert.equal(SF.canConfirmPayment(undefined, undefined), false);
  });
  it('a finance-tier viewer with no uid fails closed', () => {
    assert.equal(SF.canConfirmPayment(o(undefined), { isPresident: false, isFinanceTier: true }), false);
    assert.equal(SF.canConfirmPayment(o('u-sales'), { isPresident: false, isFinanceTier: true }), false);
  });
});

describe('decisionStamp (§14.2.2)', () => {
  it('the President: role president, not on behalf, his own uid', () => {
    assert.deepEqual(SF.decisionStamp(PRES, 'Neil Barro', '2026-11-19T02:00:00.000Z'), {
      decidedBy: 'u-pres', decidedByName: 'Neil Barro', decidedByRole: 'president', decidedAt: '2026-11-19T02:00:00.000Z', onBehalf: false,
    });
  });
  it('Finance: role finance, on behalf, her own uid', () => {
    assert.deepEqual(SF.decisionStamp(FIN, 'Shaira Doe', '2026-11-19T03:00:00.000Z'), {
      decidedBy: 'u-fin', decidedByName: 'Shaira Doe', decidedByRole: 'finance', decidedAt: '2026-11-19T03:00:00.000Z', onBehalf: true,
    });
  });
});

describe('planConfirmation (§4.1)', () => {
  it('builds the ledger row for SO-<order id> with the cash figure and the VAT split', () => {
    const p = SF.planConfirmation(order(), project(), ctxOf());
    assert.equal(p.ok, true);
    assert.equal(p.ref, 'SO-ord123');
    assert.equal(p.ledgerEntry.ref, 'SO-ord123', 'the ref is the ORDER id, never the quote id');
    assert.equal(p.ledgerEntry.kind, 'credit');
    assert.equal(p.ledgerEntry.accountType, 'income');
    assert.equal(p.ledgerEntry.account, 'Sales Revenue');
    assert.equal(p.ledgerEntry.category, 'Sales Revenue');
    assert.equal(p.ledgerEntry.source, 'Sales');
    assert.equal(p.ledgerEntry.date, '2026-11-19', 'the ledger date is the posting day, not the payment date');
    assert.equal(p.ledgerEntry.amount, 65000);
    assert.equal(p.ledgerEntry.projectId, 'prj1');
    assert.equal(p.ledgerEntry.description, 'Sales order — Acme Foods (BK-260101-001)');
    assert.deepEqual(p.ledgerEntry.extra, {
      net: 58035.71, vatAmount: 6964.29, vatTreatment: 'inclusive', confirmedBy: 'Neil Barro', confirmedByRole: 'president',
      bankAccountId: 'ba1', bankAccountName: 'BDO Main (•••• 7890)', bankFlow: 'in',
    });
  });
  it('the description drops the quote number when there is none, and the project id is null when there is no project', () => {
    const p = SF.planConfirmation(order({ quoteNumber: '', projectId: undefined }), null, ctxOf());
    assert.equal(p.ledgerEntry.description, 'Sales order — Acme Foods');
    assert.equal(p.ledgerEntry.projectId, null);
  });
  it('newCollected ADDS to what the project already collected (a deposit, then this payment)', () => {
    const p = SF.planConfirmation(order(), project({ amountCollected: 20000 }), ctxOf());
    assert.equal(p.newCollected, 85000);
    assert.equal(p.newAR, 15000);
  });
  it('with nothing collected yet, collected is this payment and AR is the rest of the contract', () => {
    const p = SF.planConfirmation(order(), project({ amountCollected: undefined }), ctxOf());
    assert.equal(p.newCollected, 65000);
    assert.equal(p.newAR, 35000);
  });
  it('AR floors at zero: an over-collection never goes negative', () => {
    const p = SF.planConfirmation(order(), project({ amountCollected: 90000 }), ctxOf());
    assert.equal(p.newCollected, 155000);
    assert.equal(p.newAR, 0);
  });
  it('AR is measured against the PROJECT\'s contract, falling back to the order\'s', () => {
    assert.equal(SF.planConfirmation(order(), project({ contractAmount: 120000 }), ctxOf()).newAR, 55000);
    assert.equal(SF.planConfirmation(order(), project({ contractAmount: 0 }), ctxOf()).newAR, 35000);
    assert.equal(SF.planConfirmation(order(), project({ contractAmount: undefined }), ctxOf()).newAR, 35000);
  });
  it('currency sums are rounded to centavos (no 0.30000000000000004)', () => {
    const p = SF.planConfirmation(order({ paymentReceived: 0.2, contractAmount: 100 }), project({ amountCollected: 0.1, contractAmount: 100 }), ctxOf());
    assert.equal(p.newCollected, 0.3);
    assert.equal(p.newAR, 99.7);
  });
  it('a fully paid contract does NOT close the job: no `stage` key anywhere in the plan', () => {
    const p = SF.planConfirmation(order({ paymentReceived: 100000 }), project({ amountCollected: 0 }), ctxOf());
    assert.equal(p.ok, true);
    assert.equal(p.newAR, 0, 'the scenario really is "AR reached zero"');
    assert.ok(!keysDeep(p).includes('stage'), 'a stage key is in the plan');
    assert.ok(!JSON.stringify(p).includes('"stage"'));
  });
  it('the project payment row carries the receipt, the method, the OR/ref, the bank account and who confirmed', () => {
    const p = SF.planConfirmation(order(), project(), ctxOf());
    assert.deepEqual(p.payment, {
      type: 'Sales Order Payment', amount: 65000, vatAmount: 6964.29, net: 58035.71, method: 'GCash', orRef: 'OR-77',
      receiptUrl: 'https://r.example/1', date: '2026-11-18', by: 'Neil Barro', recordedBy: 'Uriel', ledgerId: 'SO-ord123',
      bankAccountId: 'ba1', bankAccountName: 'BDO Main (•••• 7890)', confirmedBy: 'Neil Barro', confirmedByRole: 'president',
    });
  });
  it('the payment date defaults to today, and missing bank / receipt fields are null, never undefined', () => {
    const p = SF.planConfirmation(order({ paymentDate: undefined, receiptUrl: undefined, orRef: undefined, paymentMethod: undefined }), project(), ctxOf({ acct: {}, bankTag: {} }));
    assert.equal(p.payment.date, '2026-11-19');
    assert.equal(p.payment.receiptUrl, null);
    assert.equal(p.payment.method, '');
    assert.equal(p.payment.orRef, '');
    assert.equal(p.payment.bankAccountId, null);
    assert.equal(p.orderPatch.bankAccountId, null);
    assert.equal(p.orderPatch.bankAccountName, null);
    for (const v of Object.values(p.payment)) assert.notEqual(v, undefined);
  });
  it('the ledger id on the payment row is the sanitised ref the caller supplies', () => {
    const p = SF.planConfirmation(order({ id: 'a/b' }), project(), ctxOf({ sanitize: (r) => r.replace(/\//g, '_') }));
    assert.equal(p.ref, 'SO-a/b');
    assert.equal(p.payment.ledgerId, 'SO-a_b');
  });
  it('the project document row is a Payment Acknowledgement (A1), ref = the OR/reference Finance issued, else the amount', () => {
    const a = SF.planConfirmation(order(), project(), ctxOf());
    assert.deepEqual(a.document, { type: 'Payment Acknowledgement', ref: 'OR-77', at: '2026-11-19T02:00:00.000Z', by: 'Neil Barro' });
    const b = SF.planConfirmation(order({ orRef: '' }), project(), ctxOf());
    assert.equal(b.document.ref, '₱65000.00');
  });
  it('nothing in the plan is titled as a BIR receipt or a sales invoice', () => {
    for (const v of [PRES, FIN]) {
      const p = SF.planConfirmation(order(), project(), ctxOf({ viewer: v, who: 'X' }));
      assert.ok(!/Official Receipt/i.test(JSON.stringify(p)));
      assert.ok(!/Sales Invoice/i.test(JSON.stringify(p)));
    }
  });
  it('the timeline names who confirmed: "the President", or "Finance (Name)"', () => {
    const a = SF.planConfirmation(order(), project(), ctxOf());
    assert.deepEqual(a.timelineEvent, { at: '2026-11-19T02:00:00.000Z', event: 'Payment ₱65000.00 confirmed by the President', by: 'Neil Barro' });
    const b = SF.planConfirmation(order(), project(), ctxOf({ viewer: FIN, who: 'Shaira Doe' }));
    assert.ok(b.timelineEvent.event.includes('Finance (Shaira Doe)'), b.timelineEvent.event);
    assert.ok(!b.timelineEvent.event.includes('the President'));
  });
  it('the order patch records the confirmation, keeps the request fields, and stamps the President as decider', () => {
    const p = SF.planConfirmation(order(), project(), ctxOf());
    assert.deepEqual(p.orderPatch, {
      status: 'recorded', recordedAmount: 65000, recordedBy: 'Neil Barro', bankAccountId: 'ba1', bankAccountName: 'BDO Main (•••• 7890)',
      paymentConfirm: {
        requestedAt: '2026-11-18T01:00:00.000Z', requestedBy: 'u-sales', requestedByName: 'Uriel', resubmits: 0,
        decision: 'confirmed', reason: '', decidedBy: 'u-pres', decidedByName: 'Neil Barro', decidedByRole: 'president',
        decidedAt: '2026-11-19T02:00:00.000Z', onBehalf: false,
      },
    });
  });
  it('a Finance stand-in is recorded as such everywhere: five decider fields, ledger extra, payment row, timeline', () => {
    const p = SF.planConfirmation(order(), project(), ctxOf({ viewer: FIN, who: 'Shaira Doe', whoUid: 'u-fin' }));
    assert.equal(p.ok, true);
    const pc = p.orderPatch.paymentConfirm;
    assert.equal(pc.decidedBy, 'u-fin');
    assert.equal(pc.decidedByName, 'Shaira Doe');
    assert.equal(pc.decidedByRole, 'finance');
    assert.equal(pc.decidedAt, '2026-11-19T02:00:00.000Z');
    assert.equal(pc.onBehalf, true);
    assert.equal(pc.decision, 'confirmed');
    assert.equal(p.ledgerEntry.extra.confirmedByRole, 'finance');
    assert.equal(p.ledgerEntry.extra.confirmedBy, 'Shaira Doe');
    assert.equal(p.payment.confirmedByRole, 'finance');
    assert.equal(p.payment.confirmedBy, 'Shaira Doe');
    assert.ok(p.timelineEvent.event.includes('Finance (') && p.timelineEvent.event.includes('Shaira Doe'));
    assert.equal(p.role, 'finance');
  });
  it('the President confirming his own entry is allowed and stamped as the President', () => {
    const p = SF.planConfirmation(order({ createdBy: 'u-pres' }), project(), ctxOf());
    assert.equal(p.ok, true);
    assert.equal(p.orderPatch.paymentConfirm.decidedByRole, 'president');
  });
  it('a VAT-exclusive payment records the cash figure (amount + 12%)', () => {
    const p = SF.planConfirmation(order({ contractAmount: 120000, paymentReceived: 100000, vatTreatment: 'exclusive' }), project({ contractAmount: 120000 }), ctxOf());
    assert.equal(p.ok, true);
    assert.equal(p.amount, 112000);
    assert.equal(p.ledgerEntry.amount, 112000);
    assert.equal(p.ledgerEntry.extra.net, 100000);
    assert.equal(p.ledgerEntry.extra.vatAmount, 12000);
    assert.equal(p.ledgerEntry.extra.vatTreatment, 'exclusive');
    assert.equal(p.newAR, 8000);
  });
  it('a missing treatment defaults to inclusive', () => {
    const p = SF.planConfirmation(order({ vatTreatment: undefined }), project(), ctxOf());
    assert.equal(p.vatTreatment, 'inclusive');
    assert.equal(p.ledgerEntry.extra.vatTreatment, 'inclusive');
  });
  it('does not mutate its inputs', () => {
    const o = deepFreeze(order()), pr = deepFreeze(project({ amountCollected: 5 })), c = deepFreeze(ctxOf());
    assert.doesNotThrow(() => SF.planConfirmation(o, pr, c));
  });

  describe('every refusal code', () => {
    it('not-allowed: a viewer who is neither the President nor finance tier', () => {
      assert.deepEqual(SF.planConfirmation(order(), project(), ctxOf({ viewer: SALES })), { ok: false, code: 'not-allowed' });
    });
    it('not-allowed: a finance-tier viewer who recorded the order themselves', () => {
      assert.deepEqual(SF.planConfirmation(order({ createdBy: 'u-fin' }), project(), ctxOf({ viewer: FIN })), { ok: false, code: 'not-allowed' });
    });
    it('not-allowed: no viewer, no order, no ctx', () => {
      assert.deepEqual(SF.planConfirmation(order(), project(), ctxOf({ viewer: undefined })), { ok: false, code: 'not-allowed' });
      assert.deepEqual(SF.planConfirmation(undefined, project(), ctxOf()), { ok: false, code: 'not-allowed' });
      assert.deepEqual(SF.planConfirmation(order(), project(), undefined), { ok: false, code: 'not-allowed' });
    });
    it('not-allowed is decided BEFORE already-confirmed, not-pending or legacy-order (a stale screen cannot probe state)', () => {
      assert.equal(SF.planConfirmation(order({ status: 'recorded' }), project(), ctxOf({ viewer: SALES })).code, 'not-allowed');
      assert.equal(SF.planConfirmation(order({ status: 'payment_rejected' }), project(), ctxOf({ viewer: SALES })).code, 'not-allowed');
      assert.equal(SF.planConfirmation(order({ flowVersion: undefined }), project(), ctxOf({ viewer: SALES })).code, 'not-allowed');
    });
    it('already-confirmed: the order is already recorded', () => {
      assert.deepEqual(SF.planConfirmation(order({ status: 'recorded' }), project(), ctxOf()), { ok: false, code: 'already-confirmed' });
    });
    it('not-pending: a payment sent back to Sales (or any other status)', () => {
      assert.deepEqual(SF.planConfirmation(order({ status: 'payment_rejected' }), project(), ctxOf()), { ok: false, code: 'not-pending' });
      assert.equal(SF.planConfirmation(order({ status: undefined }), project(), ctxOf()).code, 'not-pending');
      assert.equal(SF.planConfirmation(order({ status: 'weird' }), project(), ctxOf()).code, 'not-pending');
    });
    it('legacy-order: no flowVersion (old orders are recorded by Finance\'s Record Sale)', () => {
      assert.deepEqual(SF.planConfirmation(order({ flowVersion: undefined }), project(), ctxOf()), { ok: false, code: 'legacy-order' });
      assert.equal(SF.planConfirmation(order({ flowVersion: 1 }), project(), ctxOf()).code, 'legacy-order');
    });
    it('invalid-payment: carries the validation message (zero amount, no contract, over the contract)', () => {
      assert.deepEqual(SF.planConfirmation(order({ paymentReceived: 0 }), project(), ctxOf()), { ok: false, code: 'invalid-payment', error: 'Enter the amount the client paid.' });
      assert.deepEqual(SF.planConfirmation(order({ contractAmount: 0 }), project(), ctxOf()), { ok: false, code: 'invalid-payment', error: 'This quote has no total, so a payment cannot be recorded against it.' });
      assert.deepEqual(SF.planConfirmation(order({ paymentReceived: 100000, vatTreatment: 'exclusive' }), project(), ctxOf()), { ok: false, code: 'invalid-payment', error: 'The payment is more than the contract amount.' });
    });
    it('the checks run in the documented order: already-confirmed, then not-pending, then legacy-order, then invalid-payment', () => {
      assert.equal(SF.planConfirmation(order({ status: 'recorded', flowVersion: undefined, paymentReceived: 0 }), project(), ctxOf()).code, 'already-confirmed');
      assert.equal(SF.planConfirmation(order({ status: 'payment_rejected', flowVersion: undefined, paymentReceived: 0 }), project(), ctxOf()).code, 'not-pending');
      assert.equal(SF.planConfirmation(order({ flowVersion: undefined, paymentReceived: 0 }), project(), ctxOf()).code, 'legacy-order');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// runConfirmation with fake dependencies. The fake ledger dedupes on the sanitised ref and applies the project's
// fields in the SAME call (as Ledger.post does in one transaction); the fake project counts how often it is written.
function makeWorld({ ord = order(), proj = project(), rows = {}, updateFailures = 0, viewer = PRES, who = 'Neil Barro' } = {}) {
  const log = { getOrder: [], getProject: [], ledgerPost: [], ledgerAmount: [], updateOrder: [], syncTracking: [], projectWrites: [] };
  const orders = { [ord.id]: { ...ord } };
  const state = proj ? { ...proj, payments: [], documents: [], timeline: [] } : null;
  const ledger = { ...rows };
  let failuresLeft = updateFailures;
  const deps = {
    getOrder: async (id) => { log.getOrder.push(id); return orders[id] ? { ...orders[id] } : null; },
    getProject: async (id) => { log.getProject.push(id); return state ? { ...state } : null; },
    ledgerPost: async (entry) => {
      log.ledgerPost.push(entry);
      const id = String(entry.ref).replace(/\//g, '_');
      if (ledger[id]) return { existed: true, id };
      ledger[id] = { amount: entry.amount, entry };
      if (entry.projectSync) {
        const f = entry.projectSync.fields;
        log.projectWrites.push(entry.projectSync);
        state.amountCollected = f.amountCollected;
        state.arBalance = f.arBalance;
        for (const k of ['payments', 'documents', 'timeline']) if (f[k]) state[k].push(f[k].__union);
      }
      return { existed: false, id };
    },
    ledgerAmount: async (ref) => { log.ledgerAmount.push(ref); const r = ledger[String(ref).replace(/\//g, '_')]; return r ? Number(r.amount) : null; },
    updateOrder: async (id, patch) => {
      log.updateOrder.push({ id, patch });
      if (failuresLeft > 0) { failuresLeft--; throw new Error('boom: updateOrder'); }
      Object.assign(orders[id], patch);
    },
    syncTracking: async (token, patch) => { log.syncTracking.push({ token, patch }); },
    sanitize: (r) => String(r).replace(/\//g, '_'),
    union: (x) => ({ __union: x }),
    serverTime: () => 'SERVER_TS',
    ctx: ctxOf({ viewer, who }),
  };
  return { deps, log, ledger, orders, state };
}
const noWrites = (log) => assert.deepEqual([log.ledgerPost.length, log.updateOrder.length, log.syncTracking.length, log.projectWrites.length], [0, 0, 0, 0]);

describe('runConfirmation (§4.2) — posts exactly once', () => {
  it('(1) happy path: ONE ledger post carrying the project sync, ONE order update, tracking synced', async () => {
    const w = makeWorld();
    const res = await SF.runConfirmation('ord123', w.deps);
    assert.deepEqual(res, { ok: true, code: 'posted', amount: 65000 });
    assert.equal(w.log.ledgerPost.length, 1);
    const entry = w.log.ledgerPost[0];
    assert.equal(entry.ref, 'SO-ord123');
    assert.equal(entry.source, 'Sales');
    assert.equal(entry.kind, 'credit');
    assert.equal(entry.amount, 65000);
    assert.equal(entry.projectSync.collection, 'job_projects');
    assert.equal(entry.projectSync.docId, 'prj1');
    const f = entry.projectSync.fields;
    assert.equal(f.amountCollected, 65000);
    assert.equal(f.arBalance, 35000);
    assert.equal(f.updatedAt, 'SERVER_TS');
    assert.equal(f.payments.__union.type, 'Sales Order Payment');
    assert.equal(f.documents.__union.type, 'Payment Acknowledgement');
    assert.ok(f.timeline.__union.event.includes('confirmed by the President'));
    assert.equal(w.log.updateOrder.length, 1);
    const { id, patch } = w.log.updateOrder[0];
    assert.equal(id, 'ord123');
    assert.equal(patch.status, 'recorded');
    assert.equal(patch.recordedAmount, 65000);
    assert.equal(patch.recordedAt, 'SERVER_TS');
    assert.equal(patch.paymentConfirm.decision, 'confirmed');
    assert.equal(w.log.syncTracking.length, 1);
    assert.deepEqual(w.log.syncTracking[0], { token: 'tok1', patch: { paid: 65000, balance: 35000 } });
    assert.equal(w.orders.ord123.status, 'recorded');
    assert.equal(w.state.amountCollected, 65000);
    assert.equal(w.log.projectWrites.length, 1);
  });
  it('the order is read fresh from the source, by id, and the project by the order\'s project id', async () => {
    const w = makeWorld();
    await SF.runConfirmation('ord123', w.deps);
    assert.deepEqual(w.log.getOrder, ['ord123']);
    assert.deepEqual(w.log.getProject, ['prj1']);
  });
  it('a deposit already collected on the project is added to, not replaced', async () => {
    const w = makeWorld({ proj: project({ amountCollected: 20000 }) });
    await SF.runConfirmation('ord123', w.deps);
    assert.equal(w.log.ledgerPost[0].projectSync.fields.amountCollected, 85000);
    assert.equal(w.log.ledgerPost[0].projectSync.fields.arBalance, 15000);
    assert.deepEqual(w.log.syncTracking[0].patch, { paid: 85000, balance: 15000 });
  });
  it('a fully paid contract never writes a stage to the project (it is not closed before it is built)', async () => {
    const w = makeWorld({ ord: order({ paymentReceived: 100000 }) });
    const res = await SF.runConfirmation('ord123', w.deps);
    assert.equal(res.code, 'posted');
    const f = w.log.ledgerPost[0].projectSync.fields;
    assert.equal(f.arBalance, 0);
    assert.ok(!keysDeep(f).includes('stage'));
    assert.ok(!keysDeep(w.log.updateOrder[0].patch).includes('stage'));
    assert.ok(!('stage' in w.state));
  });
  it('a Finance stand-in posts the same way and is recorded as the decider', async () => {
    const w = makeWorld({ viewer: FIN, who: 'Shaira Doe' });
    const res = await SF.runConfirmation('ord123', w.deps);
    assert.equal(res.code, 'posted');
    const pc = w.log.updateOrder[0].patch.paymentConfirm;
    assert.deepEqual([pc.decidedBy, pc.decidedByRole, pc.onBehalf], ['u-fin', 'finance', true]);
    assert.equal(w.log.ledgerPost[0].extra.confirmedByRole, 'finance');
  });
  it('(2) an order already recorded: zero ledger posts, zero writes, "already-confirmed"', async () => {
    const w = makeWorld({ ord: order({ status: 'recorded' }) });
    assert.deepEqual(await SF.runConfirmation('ord123', w.deps), { ok: false, code: 'already-confirmed' });
    noWrites(w.log);
  });
  it('(3) a payment sent back to Sales: "not-pending", zero writes', async () => {
    const w = makeWorld({ ord: order({ status: 'payment_rejected' }) });
    assert.deepEqual(await SF.runConfirmation('ord123', w.deps), { ok: false, code: 'not-pending' });
    noWrites(w.log);
  });
  it('(4) the ledger row already exists: "repaired" — the order is marked, the project is NOT written again, the amount comes from the ledger', async () => {
    const w = makeWorld({ rows: { 'SO-ord123': { amount: 70000 } }, proj: project({ amountCollected: 70000 }) });
    const res = await SF.runConfirmation('ord123', w.deps);
    assert.deepEqual(res, { ok: true, code: 'repaired', amount: 70000 });
    assert.equal(w.log.ledgerPost.length, 1, 'the project sync rides the ONE ledger post and is never sent a second time');
    assert.equal(w.log.projectWrites.length, 0, 'the existing row means nothing was written to the project');
    assert.equal(w.state.amountCollected, 70000, 'the project figure is untouched');
    assert.equal(w.log.updateOrder.length, 1);
    const patch = w.log.updateOrder[0].patch;
    assert.equal(patch.status, 'recorded');
    assert.equal(patch.recordedAmount, 70000, 'recordedAmount is the amount the ledger holds, not the amount typed');
    assert.equal(patch.recordedAt, 'SERVER_TS');
    for (const k of ['amountCollected', 'arBalance', 'payments', 'documents', 'timeline', 'updatedAt']) assert.ok(!(k in patch), `the order patch carries project field ${k}`);
    assert.deepEqual(w.log.ledgerAmount, ['SO-ord123']);
    assert.equal(w.log.syncTracking.length, 0, 'a repair does not move the client\'s tracked balance');
  });
  it('(4b) a repair with no readable ledger amount falls back to the amount computed from the order', async () => {
    const w = makeWorld({ rows: { 'SO-ord123': {} } });
    w.deps.ledgerAmount = async () => null;
    const res = await SF.runConfirmation('ord123', w.deps);
    assert.deepEqual(res, { ok: true, code: 'repaired', amount: 65000 });
    assert.equal(w.log.updateOrder[0].patch.recordedAmount, 65000);
  });
  it('(5) updateOrder throws AFTER a successful post: it rejects; a second run repairs — one ledger row, the project moved exactly once', async () => {
    const w = makeWorld({ updateFailures: 1 });
    await assert.rejects(() => SF.runConfirmation('ord123', w.deps), /boom: updateOrder/);
    assert.equal(Object.keys(w.ledger).length, 1, 'the row posted');
    assert.equal(w.log.projectWrites.length, 1, 'the project moved with it, in the same call');
    assert.equal(w.orders.ord123.status, 'pending', 'the order was not marked, so the retry has work to do');
    assert.equal(w.log.syncTracking.length, 0);
    const again = await SF.runConfirmation('ord123', w.deps);
    assert.deepEqual(again, { ok: true, code: 'repaired', amount: 65000 });
    assert.equal(Object.keys(w.ledger).length, 1, 'still exactly one ledger row');
    assert.equal(w.log.projectWrites.length, 1, 'the project was incremented exactly once across both runs');
    assert.equal(w.state.amountCollected, 65000);
    assert.equal(w.orders.ord123.status, 'recorded');
    assert.equal(w.log.ledgerPost.length, 2, 'two attempts, one of which was a no-op against the existing row');
    // and a THIRD run is refused at the plan: already confirmed
    assert.equal((await SF.runConfirmation('ord123', w.deps)).code, 'already-confirmed');
    assert.equal(w.log.ledgerPost.length, 2);
  });
  it('two concurrent taps: the ledger dedupes, so the second lands in the repair branch and the project moves once', async () => {
    const w = makeWorld();
    const [a, b] = await Promise.all([SF.runConfirmation('ord123', w.deps), SF.runConfirmation('ord123', w.deps)]);
    assert.deepEqual([a.code, b.code].sort(), ['posted', 'repaired']);
    assert.equal(Object.keys(w.ledger).length, 1);
    assert.equal(w.log.projectWrites.length, 1);
    assert.equal(w.state.amountCollected, 65000);
  });
  it('(6) a legacy order: "legacy-order", zero writes', async () => {
    const w = makeWorld({ ord: order({ flowVersion: undefined }) });
    assert.deepEqual(await SF.runConfirmation('ord123', w.deps), { ok: false, code: 'legacy-order' });
    noWrites(w.log);
  });
  it('(7) no project: posts the ledger row without a projectSync, never asks for a project', async () => {
    const w = makeWorld({ ord: order({ projectId: undefined }), proj: null });
    const res = await SF.runConfirmation('ord123', w.deps);
    assert.equal(res.code, 'posted');
    assert.equal(w.log.getProject.length, 0);
    assert.equal(w.log.ledgerPost.length, 1);
    assert.ok(!('projectSync' in w.log.ledgerPost[0]));
    assert.equal(w.log.ledgerPost[0].projectId, null);
    assert.equal(w.log.updateOrder.length, 1);
  });
  it('(7b) a project id whose project document is gone: also posts without a projectSync', async () => {
    const w = makeWorld({ proj: null });
    const res = await SF.runConfirmation('ord123', w.deps);
    assert.equal(res.code, 'posted');
    assert.equal(w.log.getProject.length, 1);
    assert.ok(!('projectSync' in w.log.ledgerPost[0]));
  });
  it('(8) a viewer who may not decide: zero ledger posts, zero order updates, zero tracking syncs', async () => {
    for (const viewer of [SALES, { uid: 'u-mgr', isPresident: false, isFinanceTier: false }, null]) {
      const w = makeWorld({ viewer });
      assert.deepEqual(await SF.runConfirmation('ord123', w.deps), { ok: false, code: 'not-allowed' });
      noWrites(w.log);
    }
  });
  it('(8b) a finance-tier user who recorded the order: not-allowed, zero writes', async () => {
    const w = makeWorld({ ord: order({ createdBy: 'u-fin' }), viewer: FIN });
    assert.deepEqual(await SF.runConfirmation('ord123', w.deps), { ok: false, code: 'not-allowed' });
    noWrites(w.log);
  });
  it('(8c) a stale screen cannot probe: an already-recorded order shows a non-allowed viewer "not-allowed", not "already-confirmed"', async () => {
    const w = makeWorld({ ord: order({ status: 'recorded' }), viewer: SALES });
    assert.equal((await SF.runConfirmation('ord123', w.deps)).code, 'not-allowed');
    noWrites(w.log);
  });
  it('(9) an order that does not exist: "not-found", nothing else is read or written', async () => {
    const w = makeWorld();
    assert.deepEqual(await SF.runConfirmation('nope', w.deps), { ok: false, code: 'not-found' });
    assert.equal(w.log.getProject.length, 0);
    noWrites(w.log);
  });
  it('(10) an invalid payment (zero, over the contract): "invalid-payment" with the message, zero writes', async () => {
    const w1 = makeWorld({ ord: order({ paymentReceived: 0 }) });
    assert.deepEqual(await SF.runConfirmation('ord123', w1.deps), { ok: false, code: 'invalid-payment', error: 'Enter the amount the client paid.' });
    noWrites(w1.log);
    const w2 = makeWorld({ ord: order({ paymentReceived: 100000, vatTreatment: 'exclusive' }) });
    assert.equal((await SF.runConfirmation('ord123', w2.deps)).code, 'invalid-payment');
    noWrites(w2.log);
  });
  it('(11) a ledger failure propagates and leaves the order untouched (closed period, denied write, network)', async () => {
    const w = makeWorld();
    w.deps.ledgerPost = async () => { throw new Error('period closed'); };
    await assert.rejects(() => SF.runConfirmation('ord123', w.deps), /period closed/);
    assert.equal(w.log.updateOrder.length, 0);
    assert.equal(w.log.syncTracking.length, 0);
  });
  it('(12) a ledger answer that does not say whether the row existed is an error, never a guess', async () => {
    for (const bad of [undefined, null, {}, { id: 'x' }, { existed: 'yes' }]) {
      const w = makeWorld();
      w.deps.ledgerPost = async () => bad;
      await assert.rejects(() => SF.runConfirmation('ord123', w.deps), /did not say whether/);
      assert.equal(w.log.updateOrder.length, 0);
    }
  });
  it('(13) an order with no tracking token still confirms (the sync is handed an empty token and no-ops)', async () => {
    const w = makeWorld({ ord: order({ trackingToken: undefined }) });
    const res = await SF.runConfirmation('ord123', w.deps);
    assert.equal(res.code, 'posted');
    assert.equal(w.log.syncTracking[0].token, undefined);
  });
});
