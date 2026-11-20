// tests/price-gate-core.test.mjs — P1 of specs/SALES-FLOW-SPEC-2026-11-19.md §6 (and the list at the end of §7.10).
// js/price-gate-core.js decides whether a revised price needs Neil again. MONEY-adjacent: every rule is mutation-tested
// (&& -> ||; unknown treated as "above"; lastApproved from a carried revision; fee lines checked at line level).
//
//
// QUOTE-PRESIDENT-FIGURES-SPEC-2026-11-20 §8 / §13.2 (appended at the end of this file): figuresBar and figuresOfferFor, the bar a quote returned WITH THE PRESIDENT'S OWN PRICES offers to the revision that follows.
// MUTATION LOG (2026-11-20, scratch copy of js/price-gate-core.js, each KILLED by the test named):
//   G1  figuresBar takes the Sales price (from) instead of his figure (to)          -> "figuresBar: a line takes his figure ..." and the evaluate tests
//   G2  figuresOfferFor ignores parentQuoteId (any returned doc of the chain offers) -> "figuresOfferFor: the parent must be the returned doc ..."
//   G3  figuresOfferFor skips the later-decision check                               -> "a later approval by the President voids the offer" and "a later return voids it"
//   G4  times compared as strings                                                    -> "mixed time types compare correctly"
//   G5  a carried approval voids the offer                                           -> "a carried approval does not void the offer"
//   G6  an unknown decision time does not void the offer                             -> "a later decision whose time is unknown voids the offer (fail closed)"
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
    assert.deepEqual(Object.keys(PG).sort(), ['REQUIRE_APPROVAL_FOR_PAYMENT', 'evaluate', 'figuresBar', 'figuresOfferFor', 'lastApprovedFromChain', 'lineKey', 'pickLastApprovedQuote', 'snapshotFromQuote', 'toMs']);
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


// ═══ QUOTE-PRESIDENT-FIGURES-SPEC-2026-11-20 §8 / §13.2 ═══
describe('figuresBar', () => {
  const returned = (over) => Object.assign({
    items: [{ name: 'A', qty: 1, unitPrice: 100 }, { name: 'B', dims: '2x2', unit: 'pc', qty: 2, unitPrice: 50 }, { name: 'C', qty: 1, unitPrice: 10 }],
    presidentFigures: { v: 1, mode: 'return', carry: true, at: '2026-11-20T01:00:00.000Z',
      lines: [{ i: 0, to: 120, from: 100, note: '' }, { i: 1, to: null, from: 50, note: 'check the size' }], totals: { before: { total: 200 }, after: { total: 240 } } } }, over || {});
  it('null unless the quote offers the carry: no presidentFigures, carry false or absent, no totals, a non-numeric total', () => {
    assert.equal(PG.figuresBar({ items: [] }), null);
    assert.equal(PG.figuresBar(null), null);
    for (const carry of [false, undefined, 'true', 1]) { const q = returned(); q.presidentFigures.carry = carry; assert.equal(PG.figuresBar(q), null, String(carry)); }
    const noTotals = returned(); delete noTotals.presidentFigures.totals; assert.equal(PG.figuresBar(noTotals), null);
    const noAfter = returned(); noAfter.presidentFigures.totals = { before: { total: 1 } }; assert.equal(PG.figuresBar(noAfter), null);
    const str = returned(); str.presidentFigures.totals.after.total = '240'; assert.equal(PG.figuresBar(str), null);
  });
  it('figuresBar: a line takes his figure (to) where he set one and the stored unit price elsewhere; a note-only row changes nothing; the total is the engine\'s "after"', () => {
    const bar = PG.figuresBar(returned());
    assert.deepEqual(bar, { total: 240, lines: [{ key: 'a||', unit: 120 }, { key: 'b|2x2|pc', unit: 50 }, { key: 'c||', unit: 10 }], at: '2026-11-20T01:00:00.000Z' });
  });
  it('a bar built from his figures is read by evaluate() like any other bar: equal carries; a higher line carries; one line below trips; the total below trips', () => {
    const bar = PG.figuresBar(returned());
    const rev = (a, b, c, total) => ({ total, items: [{ name: 'A', qty: 1, unitPrice: a }, { name: 'B', dims: '2x2', unit: 'pc', qty: 2, unitPrice: b }, { name: 'C', qty: 1, unitPrice: c }] });
    assert.equal(PG.evaluate(rev(120, 50, 10, 240), bar).needsApproval, false, 'equal');
    assert.equal(PG.evaluate(rev(130, 50, 10, 250), bar).needsApproval, false, 'a higher line');
    const low = PG.evaluate(rev(119.99, 50, 10, 240), bar); assert.equal(low.needsApproval, true, 'one line below'); assert.deepEqual(low.reasons.map((r) => r.level + ':' + r.key), ['line:a||']);
    const totalLow = PG.evaluate(rev(120, 50, 10, 239.99), bar); assert.equal(totalLow.needsApproval, true, 'the total below'); assert.equal(totalLow.reasons[0].level, 'total');
    assert.equal(PG.evaluate(rev(100, 50, 10, 240), bar).needsApproval, true, 'Sales\' own price on the line he changed trips');
  });
});

describe('figuresOfferFor', () => {
  const AT = '2026-11-20T01:00:00.000Z';
  const ts = (iso) => ({ toDate: () => new Date(iso) });
  const parent = (over) => Object.assign({ id: 'p1', approvalStatus: 'needs_revision', returnedAt: ts(AT), items: [{ name: 'A', qty: 1, unitPrice: 100 }],
    presidentFigures: { carry: true, at: AT, lines: [{ i: 0, to: 120 }], totals: { after: { total: 120 } } } }, over || {});
  const root = (over) => Object.assign({ id: 'r0', approvalStatus: 'approved', approvedBy: 'u-pres', approvedAt: ts('2026-11-10T01:00:00.000Z'), items: [{ name: 'A', qty: 1, unitPrice: 90 }] }, over || {});
  const data = { parentQuoteId: 'p1' };
  it('the offer is the returned parent itself', () => {
    const p = parent();
    assert.equal(PG.figuresOfferFor(data, [root(), p]), p);
  });
  it('figuresOfferFor: the parent must be the returned doc that carries a bar — not the root, not a doc without a parent link, not an approved or no-carry doc', () => {
    assert.equal(PG.figuresOfferFor({ parentQuoteId: 'r0' }, [root(), parent()]), null, 'the named parent is the approved root');
    assert.equal(PG.figuresOfferFor({}, [root(), parent()]), null, 'no parent link');
    assert.equal(PG.figuresOfferFor({ parentQuoteId: 'zz' }, [root(), parent()]), null, 'parent not in the chain');
    assert.equal(PG.figuresOfferFor(data, [root(), parent({ approvalStatus: 'approved' })]), null);
    const nc = parent(); nc.presidentFigures.carry = false; assert.equal(PG.figuresOfferFor(data, [root(), nc]), null);
    assert.equal(PG.figuresOfferFor(data, null), null);
    assert.equal(PG.figuresOfferFor(null, [parent()]), null);
  });
  it('a later approval by the President voids the offer; an EARLIER one does not (the root above is earlier)', () => {
    assert.ok(PG.figuresOfferFor(data, [root(), parent()]));
    const later = root({ id: 'r2', approvedAt: ts('2026-11-20T02:00:00.000Z') });
    assert.equal(PG.figuresOfferFor(data, [root(), parent(), later]), null);
  });
  it('a later return voids it; an earlier return does not', () => {
    assert.equal(PG.figuresOfferFor(data, [root(), parent(), { id: 'x', approvalStatus: 'needs_revision', returnedAt: ts('2026-11-20T03:00:00.000Z') }]), null);
    assert.ok(PG.figuresOfferFor(data, [root(), parent(), { id: 'x', approvalStatus: 'needs_revision', returnedAt: ts('2026-11-15T03:00:00.000Z') }]));
  });
  it('a carried approval does not void the offer (a carried doc is not a decision by the President), however late', () => {
    const carried = root({ id: 'r3', approvalCarriedFrom: 'r0', approvedAt: ts('2026-11-21T02:00:00.000Z') });
    assert.ok(PG.figuresOfferFor(data, [root(), parent(), carried]));
  });
  it('mixed time types compare correctly: an ISO string, a Timestamp-like, { seconds }, a Date', () => {
    const iso = '2026-11-20T00:59:59.000Z', later = '2026-11-20T01:00:01.000Z';
    const sec = (iso2) => ({ seconds: Math.floor(Date.parse(iso2) / 1000), nanoseconds: 0 });
    const forms = (i) => [i, ts(i), sec(i), new Date(i), Date.parse(i)];
    for (const f of forms(iso)) assert.ok(PG.figuresOfferFor(data, [root({ approvedAt: f }), parent()]), 'earlier, form ' + Object.prototype.toString.call(f));
    for (const f of forms(later)) assert.equal(PG.figuresOfferFor(data, [root({ id: 'r2', approvedAt: f }), parent()]), null, 'later, form ' + Object.prototype.toString.call(f));
    // the offer's own time as a Timestamp-like and as seconds
    const p2 = parent(); p2.presidentFigures.at = ts(AT);
    assert.ok(PG.figuresOfferFor(data, [root(), p2]));
    assert.equal(PG.figuresOfferFor(data, [root({ id: 'r2', approvedAt: ts(later) }), p2]), null);
  });
  it('the server stamp of his decision (atTs) is the clock when it is there: a device clock that runs fast cannot hide a later approval', () => {
    const p = parent(); p.presidentFigures.atTs = ts('2026-11-20T00:50:00.000Z'); p.presidentFigures.at = '2026-11-20T01:30:00.000Z';
    assert.equal(PG.figuresOfferFor(data, [root({ id: 'r2', approvedAt: ts('2026-11-20T01:00:00.000Z') }), p]), null);
  });
  it('a later decision whose time is unknown voids the offer (fail closed), and so does an offer whose own time is unknown', () => {
    assert.equal(PG.figuresOfferFor(data, [root({ id: 'r2', approvedAt: undefined }), parent()]), null);
    assert.equal(PG.figuresOfferFor(data, [parent(), { id: 'x', returnedAt: 'not a date' }]), null);
    const p = parent(); p.presidentFigures.at = 'nonsense'; assert.equal(PG.figuresOfferFor(data, [root(), p]), null);
  });
  it('toMs reads every form and answers null for the rest', () => {
    assert.equal(PG.toMs('2026-11-20T01:00:00.000Z'), Date.parse('2026-11-20T01:00:00.000Z'));
    assert.equal(PG.toMs({ seconds: 5, nanoseconds: 2000000 }), 5002);
    assert.equal(PG.toMs({ toMillis: () => 7 }), 7);
    for (const bad of [null, undefined, '', 'x', {}, [], NaN]) assert.equal(PG.toMs(bad), null, String(bad));
  });
});
