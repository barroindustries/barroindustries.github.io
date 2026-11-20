// tests/payment-claims-core.test.mjs — P5 "the balance payment", specs/SALES-FLOW-SPEC-2026-11-19.md §5.5, §5.6, §8.
//
// js/payment-claims-core.js: the record-form check, the exactly-once confirmation of a payment_claims doc
// (planConfirmation / runConfirmation) and the site-visit fee credit (planFeeCredit). MONEY logic: every rule below is
// mutation-tested (the six §8.5 mutations plus extras are in the WP-4A hand-back).
//
// Loads js/money-core.js, js/sales-flow-core.js and js/payment-claims-core.js as the app does.
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
const PC = require('../js/payment-claims-core.js');
const SOURCE = fs.readFileSync(new URL('../js/payment-claims-core.js', import.meta.url), 'utf8');

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────
const PRES = { uid: 'u-pres', isPresident: true, isFinanceTier: false };
const FIN = { uid: 'u-fin', isPresident: false, isFinanceTier: true };
const SALES = { uid: 'u-sales', isPresident: false, isFinanceTier: false };
const BANK = { bankAccountId: 'ba1', bankAccountName: 'BDO Main' };

const claim = (over = {}) => ({
  id: 'clm1', kind: 'balance', orderId: 'ord1', projectId: 'prj1', quoteNumber: 'BK-1', clientName: 'Acme Foods',
  paymentReceived: 35000, paymentMethod: 'bank', vatTreatment: 'inclusive', orRef: 'OR-1', paymentDate: '2026-11-19',
  receiptUrl: 'https://x/r.jpg', status: 'pending', createdBy: 'u-sales', createdByName: 'Uriel', ...over,
});
const project = (over = {}) => ({ id: 'prj1', projectNo: 'JP-2611-001', stage: 'production', contractAmount: 100000, amountCollected: 65000, arBalance: 35000, ...over });
const U = (...xs) => ({ __union: xs });
const ctxOf = (over = {}) => ({
  today: '2026-11-20', nowIso: '2026-11-20T02:00:00.000Z', who: 'Neil Barro', viewer: PRES, paNumber: 'PA-0003',
  acct: BANK, bankTag: { bankAccountId: 'ba1' }, sanitize: (r) => String(r).replace(/\//g, '_'), ...over,
});
const keysDeep = (v, acc = []) => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, acc));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.push(k); keysDeep(x, acc); }
  return acc;
};

// A fake backend: one claim, one job, a ledger keyed on ref. Records every write.
function world({ c = claim(), p = project(), existing = null, failClaimOnce = false, fees = undefined, ctx = {} } = {}) {
  const w = { claim: c, project: p, ledger: {}, ledgerCalls: [], claimPatches: [], jobWrites: 0, failClaim: failClaimOnce };
  if (existing) w.ledger[existing.ref] = existing;
  const deps = {
    getClaim: async () => w.claim,
    getProject: async () => w.project,
    ledgerPost: async (entry) => {
      w.ledgerCalls.push(entry);
      if (w.ledger[entry.ref]) return { existed: true };
      w.ledger[entry.ref] = entry;
      if (entry.projectSync) { w.jobWrites++; Object.assign(w.project, { amountCollected: entry.projectSync.fields.amountCollected, arBalance: entry.projectSync.fields.arBalance }); }
      return { existed: false };
    },
    ledgerAmount: async (ref) => (w.ledger[ref] ? w.ledger[ref].amount : null),
    updateClaim: async (id, patch) => {
      if (w.failClaim) { w.failClaim = false; throw new Error('network'); }
      w.claimPatches.push(patch); w.claim = Object.assign({}, w.claim, patch);
    },
    ctx: ctxOf(ctx), sanitize: (r) => String(r).replace(/\//g, '_'), union: U, serverTime: () => 'SERVER_TS',
  };
  if (fees) deps.getUncreditedFees = async () => fees;
  return { w, deps };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the module itself', () => {
  it('exposes the documented API and attaches window.PaymentClaims', () => {
    assert.deepEqual(Object.keys(PC).sort(), ['KINDS', 'balanceDue', 'dueFor', 'kindLabel', 'planConfirmation', 'planFeeCredit', 'runConfirmation', 'validateRecord']);
    assert.equal(globalThis.window.PaymentClaims, PC);
  });
  it('keeps the file contract: shim on line 1, module.exports at the end, pure', () => {
    assert.equal(SOURCE.split('\n')[0], "if (typeof window === 'undefined') globalThis.window = globalThis;");
    assert.ok(/module\.exports = window\.PaymentClaims;\s*$/.test(SOURCE));
    for (const banned of ['document.', 'firebase', 'db.collection', 'Date.now', 'new Date(', 'localStorage', 'innerHTML']) assert.ok(!SOURCE.includes(banned), banned);
  });
  it('kindLabel', () => {
    assert.equal(PC.kindLabel('balance'), 'Balance');
    assert.equal(PC.kindLabel('progress'), 'Progress payment');
    assert.equal(PC.kindLabel('change_order'), 'Change-order down payment');
    assert.equal(PC.kindLabel('site_visit'), 'Site-visit fee');
    assert.equal(PC.kindLabel('toString'), '');
    assert.equal(PC.kindLabel('nope'), '');
  });
});

// ── record form ────────────────────────────────────────────────────────────────────────────────────────────────
describe('validateRecord (§8.1 / P-1)', () => {
  const v = (o) => PC.validateRecord({ kind: 'balance', entered: 35000, vatTreatment: 'inclusive', hasReceipt: true, project: project(), ...o });
  it('accepts the exact balance and balance + 0.50; refuses 0.51 over', () => {
    assert.equal(v({}).ok, true);
    assert.equal(v({ entered: 35000.5 }).ok, true);
    assert.equal(v({ entered: 35000.51 }).ok, false);
    assert.equal(v({ entered: 35001 }).error, 'The payment is more than the balance due.');
  });
  it('VAT-exclusive is judged on the cash figure (entered + 12%)', () => {
    const r = v({ entered: 31250, vatTreatment: 'exclusive' }); // 35,000 cash
    assert.equal(r.ok, true); assert.equal(r.recorded, 35000);
    assert.equal(v({ entered: 35000, vatTreatment: 'exclusive' }).ok, false);
  });
  it('proof is required; amount must be > 0; kind must be valid; job must exist', () => {
    assert.equal(v({ hasReceipt: false }).error, 'Attach the receipt or proof of payment.');
    assert.equal(v({ entered: 0 }).ok, false);
    assert.equal(v({ entered: -5 }).ok, false);
    assert.equal(v({ kind: 'x' }).ok, false);
    assert.equal(v({ project: null }).ok, false);
  });
  it('reports balanceDue and the numbers even when invalid', () => {
    const r = v({ entered: 40000 });
    assert.equal(r.ok, false); assert.equal(r.balanceDue, 35000); assert.equal(r.recorded, 40000);
  });
  it('uncredited site-visit fees come off the balance due', () => {
    assert.equal(v({ fees: [{ id: 'f1', recordedAmount: 1000 }], entered: 34000 }).ok, true);
    assert.equal(v({ fees: [{ id: 'f1', recordedAmount: 1000 }], entered: 34001 }).ok, false);
    // already credited (in payments[]) → no longer subtracted
    const p = project({ payments: [{ claimId: 'f1' }] });
    assert.equal(v({ project: p, fees: [{ id: 'f1', recordedAmount: 1000 }], entered: 35000 }).ok, true);
  });
  it('a site-visit fee needs no job and has no balance cap, but needs proof', () => {
    const f = (o) => PC.validateRecord({ kind: 'site_visit', entered: 2500, hasReceipt: true, project: null, ...o });
    assert.equal(f({}).ok, true);
    assert.equal(f({ entered: 999999 }).ok, true);
    assert.equal(f({ hasReceipt: false }).ok, false);
    assert.equal(f({}).balanceDue, null);
  });
  it('arBalance missing falls back to contract - collected', () => {
    assert.equal(PC.balanceDue({ contractAmount: 100, amountCollected: 40 }), 60);
    assert.equal(PC.balanceDue(null), 0);
  });
});

// ── plan ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe('planConfirmation (§8.3)', () => {
  const plan = (c, p, x) => PC.planConfirmation(c, p, ctxOf(x));
  it('builds the ledger entry exactly as §8.3 says', () => {
    const pl = plan(claim(), project());
    assert.equal(pl.ok, true);
    assert.deepEqual(pl.ledgerEntry, {
      ref: 'PAY-clm1', date: '2026-11-20', kind: 'credit', accountType: 'income', account: 'Sales Revenue', category: 'Sales Revenue',
      description: 'Project JP-2611-001 — Acme Foods (Balance)', amount: 35000, source: 'Sales', projectId: 'prj1',
      extra: { net: 31250, vatAmount: 3750, vatTreatment: 'inclusive', confirmedBy: 'Neil Barro', bankAccountId: 'ba1' },
    });
  });
  it('collected ADDS to the fresh job figure; AR floors at 0', () => {
    const pl = plan(claim({ paymentReceived: 10000 }), project());
    assert.equal(pl.newCollected, 75000); assert.equal(pl.newAR, 25000);
    const full = plan(claim(), project());
    assert.equal(full.newCollected, 100000); assert.equal(full.newAR, 0);
    const slack = plan(claim({ paymentReceived: 35000.4 }), project());
    assert.equal(slack.ok, true); assert.equal(slack.newAR, 0);
  });
  it('VAT-exclusive claim records the cash figure', () => {
    const pl = plan(claim({ vatTreatment: 'exclusive', paymentReceived: 10000 }), project());
    assert.equal(pl.amount, 11200); assert.equal(pl.net, 10000); assert.equal(pl.vatAmount, 1200);
  });
  it('payments entry, document type and timeline event', () => {
    const pl = plan(claim(), project());
    assert.deepEqual(pl.payment, {
      type: 'Balance', amount: 35000, vatAmount: 3750, net: 31250, method: 'bank', orRef: 'OR-1', receiptUrl: 'https://x/r.jpg',
      date: '2026-11-19', by: 'Neil Barro', recordedBy: 'Uriel', ledgerId: 'PAY-clm1', claimId: 'clm1', bankAccountId: 'ba1', bankAccountName: 'BDO Main',
    });
    assert.equal(pl.document.type, 'Payment Acknowledgement');
    assert.equal(pl.document.ref, 'PA-0003');
    assert.ok(pl.timelineEvent.event.includes('₱'));
  });
  it('never sets stage anywhere in the plan, even when fully paid', () => {
    const pl = plan(claim(), project());
    assert.equal(pl.newAR, 0);
    assert.ok(!keysDeep(pl).includes('stage'));
  });
  it('claim patch: recorded, amount, paNumber, decision stamp', () => {
    const pl = plan(claim({ paymentConfirm: { note: 'keep' } }), project());
    assert.equal(pl.claimPatch.status, 'recorded');
    assert.equal(pl.claimPatch.recordedAmount, 35000);
    assert.equal(pl.claimPatch.paNumber, 'PA-0003');
    assert.equal(pl.claimPatch.paymentConfirm.decision, 'confirmed');
    assert.equal(pl.claimPatch.paymentConfirm.note, 'keep');
    assert.equal(pl.claimPatch.paymentConfirm.decidedBy, 'u-pres');
    assert.equal(pl.claimPatch.paymentConfirm.onBehalf, false);
    assert.equal(pl.claimPatch.paymentConfirm.decidedByRole, 'president');
  });
  it('stand-in stamp has onBehalf:true and decidedByRole finance', () => {
    const pl = plan(claim(), project(), { viewer: FIN, who: 'Shaira' });
    assert.equal(pl.ok, true);
    assert.equal(pl.claimPatch.paymentConfirm.onBehalf, true);
    assert.equal(pl.claimPatch.paymentConfirm.decidedByRole, 'finance');
    assert.equal(pl.claimPatch.paymentConfirm.decidedBy, 'u-fin');
    assert.ok(pl.timelineEvent.event.includes('Finance (Shaira)'));
  });
  it('a stand-in cannot confirm her own claim; the President can; Sales/none cannot', () => {
    assert.equal(plan(claim({ createdBy: 'u-fin' }), project(), { viewer: FIN }).code, 'not-allowed');
    assert.equal(plan(claim({ createdBy: 'u-pres' }), project(), { viewer: PRES }).ok, true);
    assert.equal(plan(claim(), project(), { viewer: SALES }).code, 'not-allowed');
    assert.equal(plan(claim(), project(), { viewer: null }).code, 'not-allowed');
    assert.equal(plan(null, project()).code, 'not-allowed');
  });
  it('refusal codes, each with the right precedence', () => {
    assert.equal(plan(claim({ status: 'recorded' }), project()).code, 'already-confirmed');
    assert.equal(plan(claim({ status: 'payment_rejected' }), project()).code, 'not-pending');
    assert.equal(plan(claim({ status: 'weird' }), project()).code, 'not-pending');
    assert.equal(plan(claim({ kind: 'x' }), project()).code, 'invalid-kind');
    assert.equal(plan(claim({ paymentReceived: 0 }), project()).code, 'invalid-amount');
    assert.equal(plan(claim({ paymentReceived: 'abc' }), project()).code, 'invalid-amount');
    assert.equal(plan(claim(), project(), { paNumber: '' }).code, 'missing-pa-number');
    assert.equal(plan(claim(), null).code, 'no-project');
    assert.equal(plan(claim({ paymentReceived: 35001 }), project()).code, 'over-balance');
    assert.equal(plan(claim({ paymentReceived: 35000.5 }), project()).ok, true);
    assert.equal(plan(claim({ paymentReceived: 35000.51 }), project()).code, 'over-balance');
    // not-allowed beats everything else
    assert.equal(plan(claim({ status: 'recorded' }), project(), { viewer: SALES }).code, 'not-allowed');
  });
  it('uses the fresh balance: a contract decrease makes a pending claim too large', () => {
    const p = project({ contractAmount: 90000, amountCollected: 65000, arBalance: 25000 });
    const r = plan(claim({ paymentReceived: 35000 }), p);
    assert.equal(r.code, 'over-balance'); assert.equal(r.balanceDue, 25000);
  });
  it('a contract increase never invalidates a pending claim', () => {
    assert.equal(plan(claim(), project({ contractAmount: 120000, arBalance: 55000 })).ok, true);
  });
  it('site-visit claim: no job fields, category Site Visit Fee, no amount guard, no project needed', () => {
    const c = claim({ kind: 'site_visit', orderId: null, projectId: null, paymentReceived: 2500 });
    const pl = plan(c, null);
    assert.equal(pl.ok, true);
    assert.equal(pl.ledgerEntry.category, 'Site Visit Fee');
    assert.equal(pl.ledgerEntry.ref, 'PAY-clm1');
    assert.equal(pl.ledgerEntry.projectId, null);
    assert.equal(pl.ledgerEntry.description, 'Project  — Acme Foods (Site-visit fee)');
    assert.equal(pl.payment, null); assert.equal(pl.document, null); assert.equal(pl.newCollected, null);
    // a fee larger than whatever balance is fine
    assert.equal(plan(claim({ kind: 'site_visit', paymentReceived: 999999 }), project({ arBalance: 1 })).ok, true);
    assert.equal(plan(c, null).claimPatch.paNumber, 'PA-0003');
  });
});

// ── fee credit ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('planFeeCredit (§5.6)', () => {
  const ctx = { today: '2026-11-20', who: 'Neil Barro', sanitize: (r) => r };
  it('one payments entry per uncredited fee, no ledger entry', () => {
    const r = PC.planFeeCredit(project(), [{ id: 'f1', recordedAmount: 1000 }], ctx);
    assert.deepEqual(r.entries, [{ type: 'Site-visit fee (credited)', amount: 1000, claimId: 'f1', ledgerId: 'PAY-f1', date: '2026-11-20', by: 'Neil Barro' }]);
    assert.equal(r.total, 1000);
    assert.ok(!('ledgerEntries' in r) && !keysDeep(r).includes('ref'));
  });
  it('skips fees already credited, duplicates and non-positive amounts', () => {
    const p = project({ payments: [{ claimId: 'f1' }] });
    const r = PC.planFeeCredit(p, [{ id: 'f1', recordedAmount: 1000 }, { id: 'f2', recordedAmount: 500 }, { id: 'f2', recordedAmount: 500 }, { id: 'f3', recordedAmount: 0 }, null], ctx);
    assert.equal(r.entries.length, 1); assert.equal(r.total, 500);
  });
  it('the balance claim credits the fee: collected includes it, payments gets the entry, one ledger row only', async () => {
    const fees = [{ id: 'f1', recordedAmount: 1000 }];
    const { w, deps } = world({ c: claim({ paymentReceived: 34000 }), fees });
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.code, 'posted');
    assert.equal(w.ledgerCalls.length, 1);
    assert.equal(w.ledgerCalls[0].ref, 'PAY-clm1');
    assert.equal(w.ledgerCalls[0].amount, 34000);
    const f = w.ledgerCalls[0].projectSync.fields;
    assert.equal(f.amountCollected, 100000); assert.equal(f.arBalance, 0);
    const entries = f.payments.__union;
    assert.equal(entries.length, 2);
    assert.equal(entries[0].type, 'Site-visit fee (credited)');
    assert.equal(entries[0].amount, 1000);
    assert.equal(entries[1].type, 'Balance');
  });
  it('a claim that would exceed balance-minus-fee is refused with zero writes', async () => {
    const { w, deps } = world({ c: claim({ paymentReceived: 35000 }), fees: [{ id: 'f1', recordedAmount: 1000 }] });
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.code, 'over-balance');
    assert.equal(w.ledgerCalls.length, 0); assert.equal(w.claimPatches.length, 0);
  });
  it('a site-visit claim never credits anything', async () => {
    const { w, deps } = world({ c: claim({ kind: 'site_visit', projectId: null, paymentReceived: 1000 }), fees: [{ id: 'f9', recordedAmount: 5 }] });
    await PC.runConfirmation('clm1', deps);
    assert.equal(w.ledgerCalls[0].projectSync, undefined);
  });
});

// ── run ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('runConfirmation (§8.3)', () => {
  it('happy path: exactly one ledgerPost carrying projectSync, then one claim patch', async () => {
    const { w, deps } = world();
    const r = await PC.runConfirmation('clm1', deps);
    assert.deepEqual(r, { ok: true, code: 'posted', amount: 35000, paNumber: 'PA-0003' });
    assert.equal(w.ledgerCalls.length, 1);
    const e = w.ledgerCalls[0];
    assert.equal(e.ref, 'PAY-clm1');
    assert.equal(e.projectSync.collection, 'job_projects'); assert.equal(e.projectSync.docId, 'prj1');
    assert.equal(e.projectSync.fields.amountCollected, 100000);
    assert.equal(e.projectSync.fields.updatedAt, 'SERVER_TS');
    assert.ok(!keysDeep(e).includes('stage'));
    assert.equal(w.claimPatches.length, 1);
    assert.equal(w.claimPatches[0].status, 'recorded');
    assert.equal(w.claimPatches[0].recordedAt, 'SERVER_TS');
    assert.equal(w.jobWrites, 1);
  });
  it('the ref comes from the claim id, never the order id', async () => {
    const { w, deps } = world({ c: claim({ id: 'cX', orderId: 'ordZ' }) });
    await PC.runConfirmation('cX', deps);
    assert.equal(w.ledgerCalls[0].ref, 'PAY-cX');
    assert.equal(w.ledgerCalls[0].projectSync.fields.payments.__union[0].claimId, 'cX');
  });
  it('confirm twice → one ledger row, job incremented once, second stops already-confirmed', async () => {
    const { w, deps } = world();
    await PC.runConfirmation('clm1', deps);
    const r2 = await PC.runConfirmation('clm1', deps);
    assert.equal(r2.code, 'already-confirmed');
    assert.equal(Object.keys(w.ledger).length, 1);
    assert.equal(w.ledgerCalls.length, 1);
    assert.equal(w.project.amountCollected, 100000);
  });
  it('a double tap racing on a stale read still posts once (ledger says existed)', async () => {
    const { w, deps } = world();
    const stale = w.claim;
    await PC.runConfirmation('clm1', deps);
    deps.getClaim = async () => stale; // the second tab still sees 'pending'
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.code, 'repaired');
    assert.equal(w.jobWrites, 1); assert.equal(w.project.amountCollected, 100000);
  });
  it('payment_rejected cannot be confirmed; zero writes', async () => {
    const { w, deps } = world({ c: claim({ status: 'payment_rejected' }) });
    assert.equal((await PC.runConfirmation('clm1', deps)).code, 'not-pending');
    assert.equal(w.ledgerCalls.length, 0); assert.equal(w.claimPatches.length, 0);
  });
  it('amount above the fresh balance is refused with zero writes (incl. after a contract decrease)', async () => {
    const { w, deps } = world({ p: project({ contractAmount: 90000, arBalance: 25000 }) });
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.code, 'over-balance');
    assert.equal(w.ledgerCalls.length, 0); assert.equal(w.claimPatches.length, 0);
  });
  it('every refusal writes nothing', async () => {
    const cases = [
      [{ c: null }, 'not-found'],
      [{ c: claim({ status: 'recorded' }) }, 'already-confirmed'],
      [{ ctx: { viewer: SALES } }, 'not-allowed'],
      [{ ctx: { viewer: FIN }, c: claim({ createdBy: 'u-fin' }) }, 'not-allowed'],
      [{ c: claim({ paymentReceived: 0 }) }, 'invalid-amount'],
      [{ ctx: { paNumber: null } }, 'missing-pa-number'],
      [{ p: null }, 'no-project'],
    ];
    for (const [opts, code] of cases) {
      const { w, deps } = world({ c: claim(), ...opts });
      if (opts.c === null) w.claim = null;
      if (opts.p === null) w.project = null;
      const r = await PC.runConfirmation('clm1', deps);
      assert.equal(r.code, code, code);
      assert.equal(w.ledgerCalls.length, 0, code); assert.equal(w.claimPatches.length, 0, code);
    }
  });
  it('patch throws after the post; retry is "repaired", job incremented once, job fields not re-sent', async () => {
    const { w, deps } = world({ failClaimOnce: true });
    await assert.rejects(() => PC.runConfirmation('clm1', deps), /network/);
    assert.equal(w.ledgerCalls.length, 1); assert.equal(w.claimPatches.length, 0); assert.equal(w.project.amountCollected, 100000);
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.code, 'repaired'); assert.equal(r.amount, 35000);
    // the retry posts nothing at all (the row exists), so no projectSync can be re-sent.
    assert.equal(w.ledgerCalls.length, 1);
    assert.equal(w.jobWrites, 1); assert.equal(w.project.amountCollected, 100000);
    assert.equal(w.claimPatches.length, 1); assert.equal(w.claimPatches[0].status, 'recorded');
    assert.equal(Object.keys(w.ledger).length, 1);
  });
  it('repair branch sends only claim fields — no job field names', async () => {
    const { w, deps } = world({ existing: { ref: 'PAY-clm1', amount: 34999 } });
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.code, 'repaired'); assert.equal(r.amount, 34999);
    assert.equal(w.jobWrites, 0); assert.equal(w.ledgerCalls.length, 0);
    const patch = w.claimPatches[0];
    assert.equal(patch.recordedAmount, 34999);
    for (const k of ['amountCollected', 'arBalance', 'payments', 'documents', 'timeline', 'stage']) assert.ok(!(k in patch), k);
  });
  it('repair is not blocked by the balance guard even when the job is already fully paid (project gone too)', async () => {
    const { w, deps } = world({ existing: { ref: 'PAY-clm1', amount: 35000 }, p: project({ amountCollected: 100000, arBalance: 0 }) });
    assert.equal((await PC.runConfirmation('clm1', deps)).code, 'repaired');
    w.project = null;
    w.claim = claim();
    w.claimPatches.length = 0;
    assert.equal((await PC.runConfirmation('clm1', deps)).code, 'repaired');
  });
  it('a repair still checks who may confirm and the claim status', async () => {
    const a = world({ existing: { ref: 'PAY-clm1', amount: 35000 }, ctx: { viewer: SALES } });
    assert.equal((await PC.runConfirmation('clm1', a.deps)).code, 'not-allowed');
    assert.equal(a.w.claimPatches.length, 0);
  });
  it('repair with no readable ledger amount falls back to the planned amount', async () => {
    const { w, deps } = world({ existing: { ref: 'PAY-clm1', amount: 1 } });
    deps.ledgerAmount = async () => null; // check says "no row", the post then says existed:true (concurrent confirm)
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.code, 'repaired'); assert.equal(r.amount, 35000); assert.equal(w.jobWrites, 0);
    assert.equal(w.claimPatches[0].recordedAmount, 35000);
  });
  it('a ledger that does not say existed:boolean makes it throw before any claim write', async () => {
    const { w, deps } = world();
    deps.ledgerPost = async () => ({});
    await assert.rejects(() => PC.runConfirmation('clm1', deps), /did not say/);
    assert.equal(w.claimPatches.length, 0);
  });
  it('site-visit claim posts with no projectSync, category Site Visit Fee, and never reads a job', async () => {
    const { w, deps } = world({ c: claim({ kind: 'site_visit', orderId: null, projectId: null, paymentReceived: 2500 }), p: null });
    deps.getProject = async () => { throw new Error('should not read a job'); };
    const r = await PC.runConfirmation('clm1', deps);
    assert.equal(r.code, 'posted');
    assert.equal(w.ledgerCalls.length, 1);
    assert.ok(!('projectSync' in w.ledgerCalls[0]));
    assert.equal(w.ledgerCalls[0].category, 'Site Visit Fee');
    assert.equal(w.claimPatches[0].paNumber, 'PA-0003');
  });
  it('afterPost runs on a fresh post only, and its failure never undoes the post', async () => {
    const { w, deps } = world();
    let n = 0; deps.afterPost = async () => { n++; throw new Error('boom'); };
    assert.equal((await PC.runConfirmation('clm1', deps)).code, 'posted');
    assert.equal(n, 1); assert.equal(w.claimPatches.length, 1);
  });
  it('the project is read FRESH (not the one in ctx): its collected is what the post adds to', async () => {
    const { w, deps } = world({ p: project({ amountCollected: 70000, arBalance: 30000 }), c: claim({ paymentReceived: 30000 }) });
    await PC.runConfirmation('clm1', deps);
    assert.equal(w.ledgerCalls[0].projectSync.fields.amountCollected, 100000);
  });
});

describe('the claim keeps its own "as of this payment" figures (for its Payment Acknowledgement)', () => {
  it('a confirmed claim stores collectedAfter and balanceAfter as of that payment', async () => {
    const { w, deps } = world();
    await PC.runConfirmation('clm1', deps);
    assert.equal(w.claimPatches[0].collectedAfter, 100000);
    assert.equal(w.claimPatches[0].balanceAfter, 0);
  });
  it('a partial payment: 65,000 collected + 20,000 → 85,000 collected, 15,000 balance', () => {
    const pl = PC.planConfirmation(claim({ paymentReceived: 20000 }), project(), ctxOf());
    assert.equal(pl.claimPatch.collectedAfter, 85000);
    assert.equal(pl.claimPatch.balanceAfter, 15000);
  });
  it('a repaired claim does NOT get these figures (the fresh job already counts this payment, so they would be double)', async () => {
    const { w, deps } = world({ failClaimOnce: true });
    await assert.rejects(() => PC.runConfirmation('clm1', deps), /network/);
    await PC.runConfirmation('clm1', deps);
    assert.ok(!('collectedAfter' in w.claimPatches[0]) && !('balanceAfter' in w.claimPatches[0]));
  });
  it('a site-visit fee claim has no job figures', () => {
    const pl = PC.planConfirmation(claim({ kind: 'site_visit', projectId: null }), null, ctxOf());
    assert.ok(pl.ok, pl.code);
    assert.ok(!('collectedAfter' in pl.claimPatch));
  });
});
