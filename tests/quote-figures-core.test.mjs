// tests/quote-figures-core.test.mjs — QUOTE-PRESIDENT-FIGURES-SPEC-2026-11-20 §5 / §13.1: js/quote-figures-core.js, the pure core of the President's own unit prices.
// MONEY: the three fail-closed proofs of the spec live here. P1 baselineMatches (the builder, before any figure, reproduces the stored quote), P2 verifyResult (after the figures the builder's
// answer has exactly the lines asked for, every figure landed, nothing else moved), P3 sig (the quote did not change under the page; decideQuoteApproval's refusal is pinned in
// tests/quote-president-figures.test.mjs). Every rule below is mutation-tested in a scratch copy of the repository (the shared tree is never touched).
//
// MUTATION LOG (2026-11-20; each mutant was applied to js/quote-figures-core.js in a scratch copy and this file run; every one is KILLED by the test named):
//   M1  applyToItems writes amount = to (drops the quantity)               -> "applyToItems: amount is the unit figure times the quantity"
//   M2  applyToItems skips priceManual                                     -> "applyToItems: a plain line gets priceManual and no priceBasis" (and the twin pin in quote-builder-static)
//   M3  applyToItems sets priceBasis on a plain line                       -> "applyToItems: a plain line gets priceManual and no priceBasis"
//   M4  baselineMatches compares with a tolerance of one peso              -> "P1: one centavo of difference in the total, in one unit price ..."
//   M5  baselineMatches skips the total                                    -> "P1: a missing stored total fails; a missing netAmount is skipped" and the centavo test
//   M6  verifyResult skips the untouched-line check                        -> "P2: an untouched line that moved fails"
//   M7  verifyResult skips the amount check                                -> "P2: a figure whose amount is not to x qty fails"
//   M8  holdMoved holds the applied lines too                              -> "holdMoved: an applied line is never held"
//   M9  validate accepts zero                                              -> "validate: zero and negative are refused ..."
//   M10 moneyEdits leaks clientName                                        -> "moneyEdits: exactly the allowlist ..."
//   M11 sig ignores the unit price                                         -> "P3 sig: changes with a unit price ..."
// Fixtures are synthetic (round made-up numbers). Run with: node --test tests/quote-figures-core.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
const PG = require('../js/price-gate-core.js');
const QF = require('../js/quote-figures-core.js');
const SOURCE = fs.readFileSync(path.join(ROOT, 'js/quote-figures-core.js'), 'utf8');

// strings with a currency sign or a grouped number are built here, not written out (the repository is public: no peso amount in a tracked file)
const PESO = '₱';
const grouped = (a, b) => a + ',' + b;
const line = (over) => Object.assign({ id: 'P1', name: 'Table', dims: '120x60', unit: 'pc', qty: 1, unitPrice: 1000, amount: 1000 }, over || {});
const quote = (items, over) => Object.assign({ quoteNumber: 'BKZZ-001R1', total: 5000, netAmount: 4500, subtotal: 5000, vatAmount: 0, discountAmount: 500, payment: { downPayment: 2250, balance: 2250 }, items }, over || {});

describe('module contract', () => {
  it('exports the documented members and sets window.QuoteFigures', () => {
    assert.deepEqual(Object.keys(QF).sort(), ['MAX_ROWS', 'NOTE_MAX', 'PRICE_KEYS', 'applyToItems', 'baselineMatches', 'counts', 'eligible', 'holdMoved', 'isHeaderRow', 'matchForApply', 'moneyEdits',
      'movedLines', 'noteable', 'parse', 'r2', 'restore', 'rows', 'sig', 'snapshot', 'summary', 'unitOf', 'validate', 'verifyResult']);
    assert.equal(globalThis.window.QuoteFigures, QF);
  });
  it('keeps the file contract: shim on line 1, module.exports at the end, pure (no DOM, no Firestore, no clock)', () => {
    assert.equal(SOURCE.split('\n')[0], "if (typeof window === 'undefined') globalThis.window = globalThis;");
    assert.ok(/module\.exports = window\.QuoteFigures;\s*$/.test(SOURCE));
    for (const banned of ['document.', 'firebase', 'Date.now', 'new Date(', 'localStorage', 'sessionStorage', 'fetch(']) assert.ok(!SOURCE.includes(banned), banned);
  });
  it('is lazy: no app-kit line in index.html, but it is in the review page\'s PAGE_SCRIPTS, the builder\'s loader and the precache', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.equal(html.includes('quote-figures-core.js'), false);
    assert.match(fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8'), /'quote-approval': \[[^\]]*'js\/quote-figures-core\.js'/);
    assert.ok(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes("'/js/quote-figures-core.js',"));
    assert.ok(fs.readFileSync(path.join(ROOT, 'quote-builder-v2.html'), 'utf8').includes("'js/quote-figures-core.js'"));
  });
});

describe('parse', () => {
  it('reads a currency sign, thousands commas and spaces', () => {
    assert.equal(QF.parse(PESO + grouped('1', '250') + '.50'), 1250.5);
    assert.equal(QF.parse('1250.5'), 1250.5);
    assert.equal(QF.parse(' 1 250 '), 1250);
    assert.equal(QF.parse(PESO + ' 99'), 99);
    assert.equal(QF.parse('.5'), 0.5);
    assert.equal(QF.parse('12.'), 12);
    assert.equal(QF.parse(12.5), 12.5);
  });
  it('empty to null, junk to NaN, three decimals refused, a comma that is not a thousands separator refused', () => {
    for (const e of [null, undefined, '', '   ', PESO]) assert.equal(QF.parse(e), null, String(e));
    for (const j of ['abc', '12abc', '1.2.3', '--5', '1e5', '1.234', '0.001', '1,25', '12,34,567', '1,2345', 'NaN', Infinity, NaN]) assert.ok(Number.isNaN(QF.parse(j)), String(j));
  });
  it('a minus sign parses (validate refuses it with its own sentence)', () => {
    assert.equal(QF.parse('-5'), -5);
    assert.equal(QF.validate(QF.parse('-5'), line()).ok, false);
  });
});

describe('eligible / noteable', () => {
  it('a fee line, a section header and a zero quantity take no figure', () => {
    assert.equal(QF.eligible(line()), true);
    assert.equal(QF.eligible(line({ id: 'MISCFEE' })), false);
    assert.equal(QF.eligible({ id: 'CUSTOM', name: '', qty: 1, amount: 0 }), false);
    assert.equal(QF.eligible({ id: 'CUSTOM', name: 'New item', qty: 1, amount: 0 }), false);
    assert.equal(QF.eligible(line({ qty: 0 })), false);
    assert.equal(QF.eligible(null), false);
    assert.equal(QF.eligible('x'), false);
  });
  it('a custom line with a name, or a configured custom line, is not a header', () => {
    assert.equal(QF.isHeaderRow({ id: 'CUSTOM', name: 'Special rack', qty: 1, amount: 0 }), false);
    assert.equal(QF.isHeaderRow({ id: 'CUSTOM', name: '', qty: 1, amount: 0, kcKind: 'custom' }), false);
    assert.equal(QF.isHeaderRow({ id: 'CUSTOM', name: '', qty: 1, amount: 50 }), false);
  });
  it('a fee line takes a note (only); a header takes nothing', () => {
    assert.equal(QF.noteable(line({ id: 'MISCFEE' })), true);
    assert.equal(QF.noteable({ id: 'CUSTOM', name: '', qty: 1, amount: 0 }), false);
  });
});

describe('validate', () => {
  const it0 = line({ unitPrice: 1000 });
  it('zero and negative are refused with the "above zero" sentence (a free line goes through a note); not a number is refused', () => {
    for (const v of [0, -1, -0.01]) { const r = QF.validate(v, it0); assert.equal(r.ok, false, String(v)); assert.match(r.error, /above zero.*return it with a note/); }
    for (const v of [NaN, Infinity, '12', {}]) assert.equal(QF.validate(v, it0).ok, false, String(v));
  });
  it('more than two decimals and a price over the cap are refused', () => {
    assert.equal(QF.validate(1.005, it0).ok, false);
    assert.equal(QF.validate(1000000000, it0).ok, false);
    assert.equal(QF.validate(999999999, it0).ok, true);
    assert.equal(QF.validate(10.55, it0).ok, true);
  });
  it('the same price to the centavo is "same" (no figure), not an error', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(QF.validate(1000, it0))), { ok: true, same: true, warn: [] });
    assert.equal(QF.validate(1000.004, it0).ok, false);   // three decimals: refused before it can be "same"
    assert.equal(QF.validate(null, it0).empty, true);
  });
  it('warns, never blocks: big cut (under half), big raise (over double), below cost (only with a known cost)', () => {
    assert.deepEqual(QF.validate(400, it0).warn, ['big-cut']);
    assert.deepEqual(QF.validate(500, it0).warn, []);
    assert.deepEqual(QF.validate(2500, it0).warn, ['big-raise']);
    assert.deepEqual(QF.validate(2000, it0).warn, []);
    assert.deepEqual(QF.validate(900, it0, 950).warn, ['below-cost']);
    assert.deepEqual(QF.validate(900, it0, null).warn, []);
    assert.deepEqual(QF.validate(900, it0).warn, []);
    assert.deepEqual(QF.validate(400, it0, 450).warn, ['big-cut', 'below-cost']);
    assert.equal(QF.validate(400, it0, 450).ok, true);
  });
  it('a line with no price yet (0) takes a figure without a cut / raise warning', () => {
    const r = QF.validate(300, line({ unitPrice: 0, amount: 0, needsPrice: true }));
    assert.deepEqual(JSON.parse(JSON.stringify(r)), { ok: true, warn: [] });
  });
});

describe('validate: zero and negative are refused (mutation anchor)', () => {
  it('validate: zero and negative are refused, so a free line can only be given through a note', () => {
    assert.equal(QF.validate(0, line()).ok, false);
    assert.equal(QF.validate(-5, line()).ok, false);
  });
});

describe('rows (presidentFigures.lines)', () => {
  const items = [
    { id: 'CUSTOM', name: '', qty: 1, amount: 0 },                                  // 0 section header
    line({ name: 'Sink', unitPrice: 1000, qty: 2, amount: 2000 }),                   // 1
    line({ name: 'Rack', unitPrice: 300, amount: 300 }),                              // 2
    line({ id: 'MISCFEE', name: 'Delivery', unitPrice: 200, amount: 200, dims: '' }), // 3 fee line
    line({ name: 'Shelf', unitPrice: 50, amount: 50 }),                               // 4
  ];
  const q = quote(items);
  it('in item order: a figure row and a note row; "from" is the stored unit price; "key" is the PriceGate line key; a figure carries to, a note-only row has to null', () => {
    const out = QF.rows(q, { 4: { to: 80, note: ' ' }, 1: { to: 900, note: 'check size' }, 2: { to: null, note: 'wrong colour' } });
    assert.deepEqual(out.map((r) => r.i), [1, 2, 4]);
    assert.deepEqual(out[0], { i: 1, key: PG.lineKey(items[1]), name: 'Sink', qty: 2, unit: 'pc', from: 1000, to: 900, note: 'check size' });
    assert.equal(out[1].to, null); assert.equal(out[1].note, 'wrong colour'); assert.equal(out[1].from, 300);
    assert.equal(out[2].to, 80); assert.equal(out[2].note, '');
  });
  it('a fee line keeps its note but never takes a figure; a header takes nothing; an invalid or same figure is dropped (no note: no row)', () => {
    const out = QF.rows(q, { 0: { to: 5, note: 'x' }, 3: { to: 999, note: 'ask for a quote' }, 1: { to: 1000, note: '' }, 2: { to: 0, note: '' }, 4: { to: -3, note: '' } });
    assert.deepEqual(out.map((r) => [r.i, r.to, r.note]), [[3, null, 'ask for a quote']]);
  });
  it('capped at 60 rows (the cap argument lets the page count the rest)', () => {
    const many = quote(Array.from({ length: 80 }, (_, k) => line({ name: 'L' + k, unitPrice: 10 + k, amount: 10 + k })));
    const inputs = {}; many.items.forEach((_, k) => { inputs[k] = { to: 5, note: '' }; });
    assert.equal(QF.rows(many, inputs).length, 60);
    assert.equal(QF.rows(many, inputs, 1000).length, 80);
    assert.equal(QF.MAX_ROWS, 60);
  });
  it('the note is cut at 500 and the name at 120', () => {
    const r = QF.rows(quote([line({ name: 'n'.repeat(300) })]), { 0: { to: null, note: 'z'.repeat(900) } })[0];
    assert.equal(r.note.length, 500); assert.equal(r.name.length, 120);
  });
  it('counts: prices and notes', () => {
    assert.deepEqual(QF.counts([{ to: 5, note: '' }, { to: null, note: 'x' }, { to: 6, note: 'y' }]), { prices: 2, notes: 2 });
    assert.deepEqual(QF.counts(null), { prices: 0, notes: 0 });
  });
});

describe('snapshot / restore', () => {
  it('an exact round trip, including keys that were absent (deleted again) and an object key (deep)', () => {
    const items = [line({ priceBasis: 'configured', needsPrice: true, priceHeld: true, priceBy: { role: 'president', salesPrice: 5 } }), line()];
    const before = JSON.parse(JSON.stringify(items));
    const snap = QF.snapshot(items);
    items[0].unitPrice = 1; items[0].priceBy.salesPrice = 77; delete items[0].needsPrice; items[1].priceManual = true; items[1].priceBy = { role: 'president' }; items[1].priceBasis = 'manual';
    assert.equal(QF.restore(items, snap), true);
    assert.deepEqual(JSON.parse(JSON.stringify(items)), before);
    assert.equal('priceBy' in items[1], false); assert.equal('priceBasis' in items[1], false);
  });
  it('restore refuses (false, nothing changed) when the number of lines moved', () => {
    const items = [line(), line()]; const snap = QF.snapshot(items);
    items.pop(); items[0].unitPrice = 9;
    assert.equal(QF.restore(items, snap), false);
    assert.equal(items[0].unitPrice, 9);
  });
  it('only the price keys are touched: a name edit survives a restore', () => {
    const items = [line()]; const snap = QF.snapshot(items); items[0].name = 'Renamed'; items[0].unitPrice = 3;
    QF.restore(items, snap);
    assert.equal(items[0].name, 'Renamed'); assert.equal(items[0].unitPrice, 1000);
  });
});

describe('applyToItems', () => {
  const meta = { uid: 'u-pres', name: 'The President', at: '2026-11-20T01:00:00.000Z' };
  it('applyToItems: amount is the unit figure times the quantity', () => {
    const items = [line({ qty: 3, unitPrice: 100, amount: 300 })];
    const r = QF.applyToItems(items, [{ i: 0, to: 120.5 }], meta);
    assert.deepEqual(r.applied, [0]);
    assert.equal(items[0].unitPrice, 120.5); assert.equal(items[0].amount, 361.5);
  });
  it('applyToItems: a line with a price basis gets priceBasis manual and loses needsPrice; a held price is let go', () => {
    const items = [line({ priceBasis: 'configured', needsPrice: true, priceHeld: true, unitPrice: 0, amount: 0 })];
    QF.applyToItems(items, [{ i: 0, to: 700 }], meta);
    assert.equal(items[0].priceBasis, 'manual'); assert.equal(items[0].priceManual, true);
    assert.equal('needsPrice' in items[0], false); assert.equal('priceHeld' in items[0], false);
  });
  it('applyToItems: a plain line gets priceManual and no priceBasis', () => {
    const items = [line()];
    QF.applyToItems(items, [{ i: 0, to: 700 }], meta);
    assert.equal(items[0].priceManual, true); assert.equal('priceBasis' in items[0], false);
  });
  it('priceBy records who, when and the price BEFORE; the snapshot price wins when the items were already moved', () => {
    const items = [line({ unitPrice: 1000 })];
    QF.applyToItems(items, [{ i: 0, to: 700 }], meta);
    assert.deepEqual(JSON.parse(JSON.stringify(items[0].priceBy)), { role: 'president', uid: 'u-pres', name: 'The President', at: meta.at, salesPrice: 1000 });
    const moved = [line({ unitPrice: 1234 })]; const snap = [{ has: { unitPrice: true }, val: { unitPrice: 1000 } }];
    QF.applyToItems(moved, [{ i: 0, to: 700 }], Object.assign({ snap }, meta));
    assert.equal(moved[0].priceBy.salesPrice, 1000);
  });
  it('an ineligible, missing, invalid or unchanged figure is skipped and the line is untouched', () => {
    const items = [line({ id: 'MISCFEE' }), line({ unitPrice: 50, amount: 50 }), line()];
    const before = JSON.parse(JSON.stringify(items));
    const r = QF.applyToItems(items, [{ i: 0, to: 5 }, { i: 9, to: 5 }, { i: 1, to: 0 }, { i: 2, to: 1000 }], meta);
    assert.deepEqual(r.applied, []); assert.deepEqual(r.skipped.map((s) => s.reason), ['ineligible', 'missing', 'invalid', 'same']);
    assert.deepEqual(JSON.parse(JSON.stringify(items)), before);
  });
});

describe('holdMoved', () => {
  const meta = { uid: 'u-pres', name: 'P', at: 'x' };
  it('a moved untouched line returns to its snapshot price with priceBy.held; a line that did not move is left alone', () => {
    const items = [line({ name: 'A', unitPrice: 100, amount: 100 }), line({ name: 'B', unitPrice: 200, amount: 200, qty: 2 }), line({ name: 'C', unitPrice: 300, amount: 300 })];
    const snap = QF.snapshot(items);
    items[1].unitPrice = 230; items[1].amount = 460;     // the auto-pricer spread a cost onto B
    const held = QF.holdMoved(items, snap, [0], meta);
    assert.deepEqual(held, [1]);
    assert.equal(items[1].unitPrice, 200); assert.equal(items[1].amount, 400); assert.equal(items[1].priceManual, true);
    assert.deepEqual(JSON.parse(JSON.stringify(items[1].priceBy)), { role: 'president', uid: 'u-pres', name: 'P', at: 'x', salesPrice: 200, held: true });
    assert.equal('priceBy' in items[2], false);
  });
  it('holdMoved: an applied line is never held', () => {
    const items = [line({ unitPrice: 100, amount: 100 }), line({ unitPrice: 200, amount: 200 })];
    const snap = QF.snapshot(items);
    items[0].unitPrice = 90; items[0].amount = 90; items[1].unitPrice = 210; items[1].amount = 210;
    assert.deepEqual(QF.holdMoved(items, snap, [0], meta), [1]);
    assert.equal(items[0].unitPrice, 90);
  });
  it('a basis line goes manual and loses needsPrice; a fee line and a header are never held', () => {
    const items = [line({ priceBasis: 'configured', unitPrice: 100, amount: 100 }), line({ id: 'MISCFEE', unitPrice: 5, amount: 5 })];
    const snap = QF.snapshot(items); items[0].unitPrice = 110; items[1].unitPrice = 9;
    assert.deepEqual(QF.holdMoved(items, snap, [], meta), [0]);
    assert.equal(items[0].priceBasis, 'manual'); assert.equal(items[1].unitPrice, 9);
  });
});

describe('movedLines', () => {
  it('reads (never changes) the eligible lines whose unit price differs from the snapshot to the centavo, except the skipped ones', () => {
    const items = [line({ name: 'A', unitPrice: 100, amount: 100 }), line({ name: 'B', unitPrice: 200, amount: 200 }), line({ id: 'MISCFEE', unitPrice: 5, amount: 5 }), line({ name: 'C', unitPrice: 300, amount: 300 })];
    const snap = QF.snapshot(items);
    items[0].unitPrice = 100.004; items[1].unitPrice = 201; items[2].unitPrice = 9; items[3].unitPrice = 299.99;
    const before = JSON.parse(JSON.stringify(items));
    assert.deepEqual(QF.movedLines(items, snap, []), [1, 3], 'a half-centavo is no move; a fee line is never counted');
    assert.deepEqual(QF.movedLines(items, snap, [3]), [1]);
    assert.deepEqual(JSON.parse(JSON.stringify(items)), before);
    assert.deepEqual(QF.movedLines(null, null), []);
  });
});

describe('P1 baselineMatches', () => {
  const items = [line({ unitPrice: 1000 }), line({ name: 'B', unitPrice: 250, amount: 250 })];
  const q = quote(items);
  const base = { total: 5000, netAmount: 4500, subtotal: 5000, vatAmount: 0, discountAmount: 500, downPayment: 2250 };
  const units = [1000, 250];
  it('passes when the engine reproduces the stored quote', () => assert.deepEqual(QF.baselineMatches(q, base, units), { ok: true }));
  it('P1: one centavo of difference in the total, in one unit price, or a different item count fails (no tolerance)', () => {
    assert.equal(QF.baselineMatches(q, Object.assign({}, base, { total: 5000.01 }), units).ok, false);
    assert.equal(QF.baselineMatches(q, Object.assign({}, base, { total: 4999.99 }), units).ok, false);
    assert.equal(QF.baselineMatches(q, base, [1000, 250.01]).ok, false);
    assert.equal(QF.baselineMatches(q, base, [1000]).ok, false);
    assert.equal(QF.baselineMatches(q, base, [1000, 250, 1]).ok, false);
    assert.equal(QF.baselineMatches(q, base, null).ok, false);
    assert.equal(QF.baselineMatches(q, Object.assign({}, base, { total: 5001 }), units).ok, false);
  });
  it('each of net, subtotal, VAT, discount and down payment is compared; the engine leaving one out fails', () => {
    for (const k of ['netAmount', 'subtotal', 'vatAmount', 'discountAmount', 'downPayment']) {
      assert.equal(QF.baselineMatches(q, Object.assign({}, base, { [k]: base[k] + 0.01 }), units).ok, false, k);
      assert.equal(QF.baselineMatches(q, Object.assign({}, base, { [k]: null }), units).ok, false, k + ' missing in the engine');
    }
  });
  it('P1: a missing stored total fails; a missing netAmount (or any other stored value) is skipped', () => {
    const noTotal = quote(items); delete noTotal.total;
    assert.equal(QF.baselineMatches(noTotal, base, units).ok, false);
    const noNet = quote(items); delete noNet.netAmount; delete noNet.payment;
    assert.equal(QF.baselineMatches(noNet, Object.assign({}, base, { netAmount: 1 }), units).ok, true);
    assert.deepEqual(QF.baselineMatches(q, Object.assign({}, base, { total: 1 }), units), { ok: false, reason: 'total' });
  });
});

describe('P2 verifyResult', () => {
  const items = [line({ unitPrice: 1000, qty: 2, amount: 2000 }), line({ name: 'B', unitPrice: 250, amount: 250 }), line({ id: 'MISCFEE', name: 'Delivery', unitPrice: 100, amount: 100 }), { id: 'CUSTOM', name: '', qty: 1, amount: 0, unitPrice: 0 }];
  const q = quote(items);
  const good = () => ({ quoteNumber: q.quoteNumber, items: [Object.assign({}, items[0], { unitPrice: 900, amount: 1800 }), Object.assign({}, items[1]), Object.assign({}, items[2]), Object.assign({}, items[3])] });
  const figs = [{ i: 0, to: 900 }];
  it('passes when the figure landed (unit price and amount = to x qty) and nothing else moved', () => assert.deepEqual(QF.verifyResult(q, good(), figs), { ok: true }));
  it('P2: a figure that did not land fails', () => {
    const p = good(); p.items[0].unitPrice = 1000; p.items[0].amount = 2000;
    assert.equal(QF.verifyResult(q, p, figs).ok, false);
  });
  it('P2: a figure whose amount is not to x qty fails', () => {
    const p = good(); p.items[0].amount = 900;
    assert.deepEqual(QF.verifyResult(q, p, figs), { ok: false, reason: 'amount:0' });
  });
  it('P2: an untouched line that moved fails (a fee line and a header may differ)', () => {
    const p = good(); p.items[1].unitPrice = 260; p.items[1].amount = 260;
    assert.deepEqual(QF.verifyResult(q, p, figs), { ok: false, reason: 'moved:1' });
    const f = good(); f.items[2].unitPrice = 150; f.items[2].amount = 150; f.items[3].unitPrice = 9;
    assert.equal(QF.verifyResult(q, f, figs).ok, true);
  });
  it('a changed name, quantity or unit, a different item count or a different quote number fails', () => {
    for (const mut of [(p) => { p.items[1].name = 'Bx'; }, (p) => { p.items[1].qty = 2; }, (p) => { p.items[1].unit = 'set'; }, (p) => { p.items.pop(); }, (p) => { p.items.push({}); }, (p) => { p.quoteNumber = 'other'; }]) {
      const p = good(); mut(p); assert.equal(QF.verifyResult(q, p, figs).ok, false);
    }
    assert.equal(QF.verifyResult(q, { items: null }, figs).ok, false);
    assert.equal(QF.verifyResult(q, null, figs).ok, false);
  });
  it('a figure on a missing, ineligible or non-numeric target fails closed (it can never go unverified)', () => {
    assert.equal(QF.verifyResult(q, good(), [{ i: 9, to: 5 }]).ok, false);
    assert.equal(QF.verifyResult(q, good(), [{ i: 2, to: 5 }]).ok, false);
    assert.equal(QF.verifyResult(q, good(), [{ i: 0, to: 'x' }]).ok, false);
    assert.equal(QF.verifyResult(q, { quoteNumber: q.quoteNumber, items: items.map((x) => Object.assign({}, x)) }, []).ok, true, 'no figures, nothing moved: the base answer');
    assert.equal(QF.verifyResult(q, good(), []).ok, false, 'no figures but a line moved');
  });
});

describe('P3 sig', () => {
  const base = () => quote([line({ unitPrice: 1000 }), line({ name: 'B', unitPrice: 250, amount: 250 })]);
  it('P3 sig: changes with a unit price, a quantity, a unit, a name and the total — and with nothing else', () => {
    const s = QF.sig(base());
    const m = (f) => { const q = base(); f(q); return QF.sig(q); };
    assert.notEqual(m((q) => { q.items[0].unitPrice = 1000.01; }), s);
    assert.notEqual(m((q) => { q.items[1].qty = 2; }), s);
    assert.notEqual(m((q) => { q.items[1].unit = 'set'; }), s);
    assert.notEqual(m((q) => { q.items[0].name = 'Tablet'; }), s);
    assert.notEqual(m((q) => { q.total = 5001; }), s);
    assert.equal(m((q) => { q.clientName = 'Someone'; q.items[0].notes = 'n'; q.netAmount = 1; }), s);
  });
  it('is stable under key order and is a string', () => {
    const a = { total: 5, items: [{ name: 'x', qty: 1, unit: 'pc', unitPrice: 2 }] }, b = { items: [{ unitPrice: 2, unit: 'pc', qty: 1, name: 'x' }], total: 5 };
    assert.equal(typeof QF.sig(a), 'string'); assert.equal(QF.sig(a), QF.sig(b));
    assert.equal(typeof QF.sig({}), 'string');
  });
});

describe('summary', () => {
  it('reads the totals of a payload (or a stored quote) as centavo-rounded numbers, null when absent', () => {
    assert.deepEqual(QF.summary({ subtotal: 10.004, discountAmount: '2', netAmount: 8, vatAmount: null, total: 9.999, payment: { downPayment: 4.5, balance: 5 }, commissionAmount: undefined }),
      { subtotal: 10, discountAmount: 2, netAmount: 8, vatAmount: null, total: 10, downPayment: 4.5, balance: 5, commissionAmount: null });
    assert.deepEqual(QF.summary(null), { subtotal: null, discountAmount: null, netAmount: null, vatAmount: null, total: null, downPayment: null, balance: null, commissionAmount: null });
  });
});

describe('moneyEdits', () => {
  const payload = {
    quoteNumber: 'BKZZ-001R1', company: 'BK', clientName: 'Someone', clientCompany: 'Co', clientAddress: 'x', clientPhone: '1', clientEmail: 'a@b.test', salesperson: 'S', purpose: 'p', subject: 's', location: 'l', leadSource: 'w',
    quoteDate: '2026-11-20', items: [{ name: 'A', unitPrice: 5, qty: 1, amount: 5, gone: undefined }], photos: [], subtotal: 5, volumeBreakTotal: 0, deliveryInstall: { amount: 1 }, timeline: { leadDays: 3 }, remarks: 'r', bankDetails: 'b', validUntil: '2026-12-20',
    discountPct: 10, discountAmount: 0.5, netAmount: 4.5, vatIncluded: true, vatAmount: 0.5, total: 5, grandTotal: 5, optionsMode: false, options: null, optionsBasis: '', commissionPct: 2, commissionAmount: 0.1,
    payment: { downPayment: 2.5, balance: 2.5, milestones: null }, editableState: { items: [], clientName: 'Someone', quoteNo: 'BKZZ-001R1' }, rootQuoteId: 'r1', parentQuoteId: 'p1', sourceRef: { kind: 'qr', ref: 'QR-1' },
  };
  it('moneyEdits: exactly the allowlist (money, lines, editable snapshot), never a client field, the number, the dates, the timeline, sourceRef or a chain id', () => {
    const e = QF.moneyEdits(payload);
    assert.deepEqual(Object.keys(e).sort(), ['commissionAmount', 'commissionPct', 'deliveryInstall', 'discountAmount', 'discountPct', 'editableState', 'grandTotal', 'items', 'netAmount', 'options', 'optionsBasis', 'optionsMode',
      'payment', 'subtotal', 'total', 'vatAmount', 'vatIncluded', 'volumeBreakTotal']);
    for (const k of ['clientName', 'clientCompany', 'clientAddress', 'clientPhone', 'clientEmail', 'quoteNumber', 'quoteDate', 'validUntil', 'timeline', 'sourceRef', 'rootQuoteId', 'parentQuoteId', 'company', 'salesperson', 'photos', 'remarks'])
      assert.equal(k in e, false, k);
    assert.equal(e.total, 5); assert.equal(e.payment.downPayment, 2.5); assert.equal(e.items.length, 1);
  });
  it('missing keys get the QUOTE_UPDATE defaults and no undefined survives (Firestore refuses it)', () => {
    const e = QF.moneyEdits({});
    assert.deepEqual(JSON.parse(JSON.stringify(e)), { items: [], subtotal: 0, volumeBreakTotal: 0, total: 0, grandTotal: 0, optionsMode: false, options: null, optionsBasis: '', vatIncluded: false, vatAmount: 0, discountPct: 0,
      discountAmount: 0, netAmount: 0, deliveryInstall: null, commissionPct: 0, commissionAmount: 0, payment: null, editableState: null });
    for (const v of Object.values(QF.moneyEdits(payload))) assert.notEqual(v, undefined);
    assert.equal('gone' in QF.moneyEdits(payload).items[0], false);
  });
  it('the result is a copy: changing it never changes the payload', () => {
    const e = QF.moneyEdits(payload); e.items[0].unitPrice = 99; e.payment.downPayment = 1;
    assert.equal(payload.items[0].unitPrice, 5); assert.equal(payload.payment.downPayment, 2.5);
  });
});

describe('matchForApply', () => {
  const items = [line({ name: 'Sink', qty: 2 }), line({ name: 'Rack' }), line({ id: 'MISCFEE', name: 'Delivery' }), { id: 'CUSTOM', name: '', qty: 1, amount: 0 }];
  const row = (i, name, qty, to, note) => ({ i, name, qty, unit: 'pc', from: 1, to, note: note || '' });
  it('pairs a row with the item at its index only when the name (first 120 chars) and the quantity agree', () => {
    const r = QF.matchForApply(items, [row(0, 'Sink', 2, 900), row(1, 'Rack', 5, 200), row(1, 'Other', 1, 200)]);
    assert.deepEqual(r.matched.map((m) => m.idx), [0]);
    assert.equal(r.unmatched.length, 2);
  });
  it('a reordered item matches by the caller\'s index only when name and quantity agree there', () => {
    const swapped = [items[1], items[0]];
    assert.equal(QF.matchForApply(swapped, [row(0, 'Sink', 2, 900)]).matched.length, 0);
    assert.equal(QF.matchForApply(swapped, [row(1, 'Sink', 2, 900)]).matched.length, 1);
  });
  it('a note-only row matches a fee line; a price row does not; a header and a missing index match nothing', () => {
    assert.equal(QF.matchForApply(items, [row(2, 'Delivery', 1, null, 'ask')]).matched.length, 1);
    assert.equal(QF.matchForApply(items, [row(2, 'Delivery', 1, 100)]).matched.length, 0);
    assert.equal(QF.matchForApply(items, [row(3, '', 1, null, 'x')]).matched.length, 0);
    assert.equal(QF.matchForApply(items, [row(9, 'Sink', 2, 1)]).unmatched.length, 1);
    assert.deepEqual(QF.matchForApply(null, null), { matched: [], unmatched: [] });
  });
});
