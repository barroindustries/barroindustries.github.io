// tests/price-gate-core.test.mjs — P1 of specs/SALES-FLOW-SPEC-2026-11-19.md §6 (and the list at the end of §7.10).
// js/price-gate-core.js decides whether a revised price needs Neil again. MONEY-adjacent: every rule is mutation-tested
// (&& -> ||; unknown treated as "above"; lastApproved from a carried revision; fee lines checked at line level).
//
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const PG = require('../js/price-gate-core.js');
const SOURCE = fs.readFileSync(new URL('../js/price-gate-core.js', import.meta.url), 'utf8');

const L = (key, unit, std = null, mode = 'unknown', extra = {}) => ({ key, name: key.toUpperCase(), qty: 1, unit, std, mode, ...extra });
const pc = (total, stdTotal, lines) => ({ v: 1, source: 'qb2', basis: 'net', total, stdTotal, lines });
const approved = (total, lines) => ({ total, lines: lines.map(([key, unit]) => ({ key, unit })) });

describe('module contract', () => {
  it('exports the documented members; F7 flag defaults to false', () => {
    assert.deepEqual(Object.keys(PG).sort(), ['REQUIRE_APPROVAL_FOR_PAYMENT', 'evaluate', 'lastApprovedFromChain', 'lineKey', 'snapshotFromQuote']);
    assert.equal(PG.REQUIRE_APPROVAL_FOR_PAYMENT, false);
    assert.equal(globalThis.window.PriceGate, PG);
  });
  it('keeps the file contract: shim on line 1, module.exports at the end, pure', () => {
    assert.equal(SOURCE.split('\n')[0], "if (typeof window === 'undefined') globalThis.window = globalThis;");
    assert.ok(/module\.exports = window\.PriceGate;\s*$/.test(SOURCE));
    for (const banned of ['document.', 'firebase', 'Date.now', 'new Date(', 'localStorage']) assert.ok(!SOURCE.includes(banned), banned);
  });
});

describe('lineKey', () => {
  it('uses lineId when given', () => assert.equal(PG.lineKey({ lineId: 'L7', name: 'x' }), 'L7'));
  it('else lower-cased name + dimensions + unit', () => {
    assert.equal(PG.lineKey({ name: ' Steel Table ', dimensions: '120X60', unit: 'PC' }), 'steel table|120x60|pc');
    assert.equal(PG.lineKey({ name: 'Steel Table', dimensions: '120x60', unit: 'pc' }), 'steel table|120x60|pc');
  });
});

describe('evaluate — the P1 rule (§6.1, §6.2)', () => {
  it('total-only trip: lines fine, total cut below approved and below standard', () => {
    const r = PG.evaluate(pc(900, 950, [L('a', 100, 80, 'cost')]), approved(1000, [['a', 100]]));
    assert.equal(r.needsApproval, true);
    assert.deepEqual(r.reasons.map((x) => x.level), ['total']);
    assert.deepEqual(r.reasons[0], { level: 'total', key: 'total', name: 'Total', price: 900, approved: 1000, std: 950 });
  });
  it('line-only trip: total held, one line cut under both approved and standard', () => {
    const r = PG.evaluate(pc(1000, 900, [L('a', 80, 90, 'cost'), L('b', 120, 100, 'cost')]), approved(1000, [['a', 100], ['b', 100]]));
    assert.equal(r.needsApproval, true);
    assert.deepEqual(r.reasons.map((x) => [x.level, x.key]), [['line', 'a']]);
  });
  it('a cut that stays at or above standard does not trip (the && of the rule)', () => {
    const r = PG.evaluate(pc(900, 900, [L('a', 90, 90, 'cost')]), approved(1000, [['a', 100]]));
    assert.equal(r.needsApproval, false);
    assert.deepEqual(r.reasons, []);
  });
  it('below standard but not below the approved price does not trip (a rise, or holding)', () => {
    const r = PG.evaluate(pc(1000, 1200, [L('a', 100, 120, 'cost')]), approved(1000, [['a', 100]]));
    assert.equal(r.needsApproval, false);
  });
  it('equal is not below: P == lastApproved and P == std both pass', () => {
    assert.equal(PG.evaluate(pc(1000, 1100, [L('a', 100, 110)]), approved(1000, [['a', 100]])).needsApproval, false);
    assert.equal(PG.evaluate(pc(900, 900, [L('a', 90, 90)]), approved(1000, [['a', 100]])).needsApproval, false);
  });
  it('compares in centavos (a float dust difference is not a cut)', () => {
    assert.equal(PG.evaluate(pc(0.1 + 0.2, null, []), approved(0.3, [])).needsApproval, false);
  });
  it('new line (no match): below a KNOWN standard needs approval; at standard does not', () => {
    const base = approved(1000, [['a', 100]]);
    const below = PG.evaluate(pc(1200, 1200, [L('a', 100, 90, 'cost'), L('new', 99, 100, 'cost')]), base);
    assert.equal(below.needsApproval, true);
    assert.deepEqual(below.reasons.map((x) => [x.level, x.key, x.approved]), [['line', 'new', null]]);
    const at = PG.evaluate(pc(1200, 1200, [L('a', 100, 90, 'cost'), L('new', 100, 100, 'cost')]), base);
    assert.equal(at.needsApproval, false);
  });
  it('new line with an UNKNOWN standard has no approved price to cut: no line trip (spec gap, resolved)', () => {
    assert.equal(PG.evaluate(pc(1200, null, [L('a', 100), L('new', 1)]), approved(1000, [['a', 100]])).needsApproval, false);
  });
  it('quantity changes are ignored', () => {
    const r = PG.evaluate(pc(1000, null, [L('a', 100, null, 'unknown', { qty: 50 })]), approved(1000, [['a', 100]]));
    assert.equal(r.needsApproval, false);
  });
  it('fee lines count in the total but are skipped at line level', () => {
    const lines = [L('a', 100, 80, 'cost'), L('delivery', 10, null, 'fee')];
    const r = PG.evaluate(pc(1000, 900, lines), approved(1000, [['a', 100], ['delivery', 500]]));
    assert.equal(r.needsApproval, false);                       // delivery cut from 500 to 10 is NOT a line trip
    const r2 = PG.evaluate(pc(900, null, lines), approved(1000, [['a', 100], ['delivery', 500]]));
    assert.deepEqual(r2.reasons.map((x) => x.level), ['total']); // but it can drag the total
  });
});

describe('evaluate — unknown standard (§6.4)', () => {
  it('with a cut: any cut below the approved price trips (total with stdTotal null, line with std null)', () => {
    const r = PG.evaluate(pc(990, null, [L('a', 99, null, 'unknown')]), approved(1000, [['a', 100]]));
    assert.deepEqual(r.reasons.map((x) => x.level), ['total', 'line']);
  });
  it('with a rise or a hold: never trips', () => {
    assert.equal(PG.evaluate(pc(1100, null, [L('a', 110)]), approved(1000, [['a', 100]])).needsApproval, false);
    assert.equal(PG.evaluate(pc(1000, null, [L('a', 100)]), approved(1000, [['a', 100]])).needsApproval, false);
  });
  it('a quote with no priceCheck is all-unknown: a cut trips, a hold does not', () => {
    const q = (total, unit) => ({ total, items: [{ name: 'Table', qty: 2, unitPrice: unit }] });
    const snap = PG.snapshotFromQuote({ total: 1000, items: [{ name: 'Table', qty: 2, unitPrice: 500 }] });
    assert.equal(PG.evaluate(q(900, 450), snap).needsApproval, true);
    assert.equal(PG.evaluate(q(1000, 500), snap).needsApproval, false);
  });
  it('a quote WITH a priceCheck uses it', () => {
    const q = { total: 900, items: [], priceCheck: pc(900, 850, [L('a', 90, 85, 'cost')]) };
    assert.equal(PG.evaluate(q, approved(1000, [['a', 100]])).needsApproval, false);    // above std 850 / 85
  });
});

describe('evaluate — nothing to compare with', () => {
  it('no lastApproved (nothing ever approved by Neil): the gate does not run', () => {
    const r = PG.evaluate(pc(1, null, []), null);
    assert.equal(r.needsApproval, false);
    assert.equal(r.skipped, true);
  });
});

describe('carried approvals do not move the bar (§6.5)', () => {
  it('three small cuts in a row are each compared with the figure Neil approved himself', () => {
    const neil = approved(1000, [['a', 100]]);
    // each revision cut 4% from the previous; all unknown standard
    const r1 = PG.evaluate(pc(960, null, [L('a', 96)]), neil);
    const r2 = PG.evaluate(pc(921.6, null, [L('a', 92.16)]), neil);
    // r1 is ALREADY a cut below Neil's figure with unknown std -> goes to Neil; to model a carried one the std must be below P
    assert.equal(r1.needsApproval, true);
    assert.equal(r2.needsApproval, true);
    // with a known standard of 900, 960 passes (carried) and 921.6 passes; but 880 must trip against 1000, not against 921.6
    const carried = PG.evaluate(pc(921.6, 900, [L('a', 92.16, 90)]), neil);
    assert.equal(carried.needsApproval, false);
    const third = PG.evaluate(pc(880, 900, [L('a', 88, 90)]), neil);
    assert.equal(third.needsApproval, true);
    assert.equal(third.reasons[0].approved, 1000);   // Neil's own figure, not the carried 921.6
  });
});

describe('snapshotFromQuote (§6.5)', () => {
  it('builds from an old approved quote total + items (no priceCheck, no snapshot)', () => {
    const s = PG.snapshotFromQuote({ total: 12345.678, items: [{ lineId: 'x1', name: 'A', qty: 3, unitPrice: 100.004 }, { name: 'Gate', dimensions: '2m', unit: 'pc', qty: 2, amount: 400 }] });
    assert.deepEqual(s, { total: 12345.68, lines: [{ key: 'x1', unit: 100 }, { key: 'gate|2m|pc', unit: 200 }] });
  });
  it('falls back through grandTotal / amount', () => {
    assert.equal(PG.snapshotFromQuote({ grandTotal: 500, items: [] }).total, 500);
    assert.equal(PG.snapshotFromQuote({ amount: 700 }).total, 700);
  });
  it('prefers priceCheck when present', () => {
    const s = PG.snapshotFromQuote({ total: 1, priceCheck: pc(800, null, [L('k', 80)]) });
    assert.deepEqual(s, { total: 800, lines: [{ key: 'k', unit: 80 }] });
  });
  it('an old snapshot feeds evaluate end to end', () => {
    const snap = PG.snapshotFromQuote({ total: 1000, items: [{ name: 'Table', qty: 1, unitPrice: 1000 }] });
    assert.equal(PG.evaluate({ total: 950, items: [{ name: 'Table', qty: 1, unitPrice: 950 }] }, snap).needsApproval, true);
    assert.equal(PG.evaluate({ total: 1050, items: [{ name: 'Table', qty: 1, unitPrice: 1050 }] }, snap).needsApproval, false);
  });
});

describe('lastApprovedFromChain (§6.5) — carried approvals never move the bar', () => {
  const neilQ = { approvedBy: 'u-pres', approvedAt: '2026-11-01T00:00:00Z', total: 1000, items: [{ name: 'T', qty: 1, unitPrice: 1000 }] };
  const carriedQ = { approvedBy: 'u-pres', approvalCarriedFrom: 'q1', approvedAt: '2026-11-05T00:00:00Z', total: 900, items: [{ name: 'T', qty: 1, unitPrice: 900 }] };
  it('picks the newest quote Neil approved himself, ignoring a newer carried one', () => {
    assert.equal(PG.lastApprovedFromChain([neilQ, carriedQ]).total, 1000);
  });
  it('among Neil\'s own approvals picks the newest; uses approvedSnapshot when present', () => {
    const newer = { approvedBy: 'u-pres', approvedSnapshot: { total: 1200, lines: [{ key: 'k', unit: 1200 }], at: '2026-11-10T00:00:00Z' } };
    assert.deepEqual(PG.lastApprovedFromChain([neilQ, newer, carriedQ]), { total: 1200, lines: [{ key: 'k', unit: 1200 }] });
  });
  it('nothing approved by Neil (unapproved, or only carried) → null', () => {
    assert.equal(PG.lastApprovedFromChain([{ total: 5 }, carriedQ]), null);
    assert.equal(PG.lastApprovedFromChain([]), null);
  });
});
