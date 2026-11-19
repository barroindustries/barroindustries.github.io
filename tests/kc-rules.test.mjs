// tests/kc-rules.test.mjs: qb/kc-rules.js, the pure money and approval rules of the Barro Kitchens configurators in the live quote builder
// (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md sections 1.3, 3.4, 3.5 and 6.2).
//
// Every figure below is small, made up and worked out by hand in the test (the arithmetic is written next to it), so the file carries no real price and each
// rule can be checked with a pencil. Where a number could hide a mistake (a share that is a multiple of 10 would round the same before and after) it was chosen so
// that the right rule and the wrong rule give DIFFERENT answers.
//
// Mutation-tested in scratch copies (never the shared tree). Each of these must fail here: round10 to the nearest 100; r1 misc on the materials only; r1 ignoring a typed
// labor; sellUnit adding the share after the rounding; sellUnit dropping the list adjustment; bracketOfSection('cook') as Medium; belowMarkupThreshold ignoring floorMode;
// standardUnit using the project cost without the markup; approvalRequired ignoring reviewOpen / locking the President / ignoring approveAll; needsReapproval with && turned
// into || (cost known), with an unknown cost returning false, with "<" turned into "<="; shouldHold ignoring fromFiled; discountCap without the floor at zero; and the standard price
// list rules of Addendum 1 A1: nearestStd taking the longer length on a tie / the first length / the farthest; lengthAdj dropping the metre scale, flipping its sign, ignoring the
// per-metre rate; listAdj dropping the length difference or adding the base price instead of taking it off; formulaBelowList at 80 %, at 90 % inclusive, ignoring the floor mode.
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../qb/kc-rules.js');

describe('round10: the nearest 10 pesos (R6)', () => {
  it('rounds down below the half, up from the half', () => {
    assert.equal(R.round10(1234), 1230);      // 123.4 -> 123 -> 1230
    assert.equal(R.round10(1236), 1240);      // 123.6 -> 124 -> 1240
    assert.equal(R.round10(1235), 1240);      // 123.5 -> 124 (a half goes up)
    assert.equal(R.round10(4), 0);
    assert.equal(R.round10(5), 10);
    assert.equal(R.round10(14.99), 10);
    assert.equal(R.round10(15), 20);
  });
  it('keeps a multiple of 10 as it is and rounds the centavos away', () => {
    assert.equal(R.round10(1230), 1230);
    assert.equal(R.round10(1230.4), 1230);
    assert.equal(R.round10(0), 0);
  });
});

describe('r1: labor and misc on the project cost', () => {
  it('labor is the bracket % of the materials, misc is the misc % of (materials + labor)', () => {
    // M 1000, bracket 50 %, misc 25 %: labor 500, misc 0.25 x (1000 + 500) = 375, cost 1000 + 500 + 375 = 1875
    assert.deepEqual(R.r1(1000, 50, 25), { labor: 500, misc: 375, projectCost: 1875 });
    // bracket 30 %: labor 300, misc 0.25 x 1300 = 325, cost 1625
    assert.deepEqual(R.r1(1000, 30, 25), { labor: 300, misc: 325, projectCost: 1625 });
  });
  it('a typed labor replaces the bracket labor, and misc follows it', () => {
    // typed labor 200: misc 0.25 x (1000 + 200) = 300, cost 1500
    assert.deepEqual(R.r1(1000, 50, 25, 200), { labor: 200, misc: 300, projectCost: 1500 });
  });
  it('a typed labor of zero is a typed labor (it is not "not given")', () => {
    // labor 0, misc 0.25 x 1000 = 250, cost 1250
    assert.deepEqual(R.r1(1000, 50, 25, 0), { labor: 0, misc: 250, projectCost: 1250 });
  });
  it('null and undefined mean "not typed"', () => {
    assert.equal(R.r1(1000, 50, 25, null).labor, 500);
    assert.equal(R.r1(1000, 50, 25, undefined).labor, 500);
  });
});

describe('sellUnit: markup, list adjustment and distributed share, rounded once', () => {
  it('project cost x markup, nearest 10', () => {
    assert.equal(R.sellUnit({ projectCost: 1000, markup: 2 }), 2000);
    assert.equal(R.sellUnit({ projectCost: 1234.5, markup: 1.5 }), 1850);     // 1851.75 -> 185.175 -> 185 -> 1850
  });
  it('the list adjustment is added before the rounding (a standard list price plus what the options add)', () => {
    // 1000 x 2 + (-437) = 1563 -> 156.3 -> 156 -> 1560 (without the adjustment it would be 2000)
    assert.equal(R.sellUnit({ projectCost: 1000, markup: 2, listAdj: -437 }), 1560);
    assert.equal(R.sellUnit({ projectCost: 1000, markup: 2, listAdj: 337 }), 2340);   // 2337 -> 233.7 -> 234
  });
  it('the distributed share is added BEFORE the rounding, not after', () => {
    // 2000 + 4 = 2004 -> 200.4 -> 200 -> 2000 (added after rounding it would be 2000 + 4 = 2004)
    assert.equal(R.sellUnit({ projectCost: 1000, markup: 2, share: 4 }), 2000);
    // 2000 + 6 = 2006 -> 200.6 -> 201 -> 2010 (added after rounding it would be 2006)
    assert.equal(R.sellUnit({ projectCost: 1000, markup: 2, share: 6 }), 2010);
  });
  it('list adjustment and share together: 1000 x 2 - 437 + 6 = 1569 -> 1570', () => {
    assert.equal(R.sellUnit({ projectCost: 1000, markup: 2, listAdj: -437, share: 6 }), 1570);
  });
  it('a missing adjustment or share is zero', () => {
    assert.equal(R.sellUnit({ projectCost: 500, markup: 3, listAdj: undefined, share: undefined }), 1500);
    assert.equal(R.sellUnit({ projectCost: 500, markup: 3, listAdj: null, share: null }), 1500);
  });
});

describe('bracketOfSection: Cooking and Baking are Complex, every other section Medium (Q42)', () => {
  it('cook, cooking_line and baking are complex', () => {
    assert.equal(R.bracketOfSection('cook'), 'complex');
    assert.equal(R.bracketOfSection('cooking_line'), 'complex');
    assert.equal(R.bracketOfSection('baking'), 'complex');
  });
  it('every other section is medium, whatever it is called', () => {
    ['prep', 'wash', 'vent', 'cold', 'multi', 'mech', 'prep_washing', 'misc', 'Option B', '', undefined, null, 5].forEach(id => assert.equal(R.bracketOfSection(id), 'medium', String(id)));
  });
  it('is not fooled by the names every object has', () => {
    ['constructor', 'toString', 'hasOwnProperty', '__proto__'].forEach(id => assert.equal(R.bracketOfSection(id), 'medium', id));
  });
  it('is case-sensitive: the section ids are the lower-case keys', () => {
    assert.equal(R.bracketOfSection('Cook'), 'medium');
    assert.equal(R.bracketOfSection('BAKING'), 'medium');
  });
});

describe('standardUnit: what a line counts for in the standard total (section 3.4)', () => {
  const kc = o => R.standardUnit(Object.assign({ kind: 'kc', floorMode: 'list', projectCost: 1000, stdMarkup: 2, quoted: 777 }, o));
  it('a list-priced configured line counts at its list-based auto price in list mode', () => {
    assert.deepEqual(kc({ listAuto: 1830 }), { unit: 1830, known: true });
  });
  it('...and at project cost x the standard markup, nearest 10, in formula mode', () => {
    assert.deepEqual(kc({ listAuto: 1830, floorMode: 'formula' }), { unit: 2000, known: true });
    assert.deepEqual(kc({ listAuto: 1830, floorMode: 'formula', projectCost: 1234 }), { unit: 2470, known: true });   // 1234 x 2 = 2468 -> 2470
  });
  it('any other configured line with a cost counts at project cost x the standard markup (the markup is applied)', () => {
    assert.deepEqual(kc({ projectCost: 1234, stdMarkup: 1.5 }), { unit: 1850, known: true });          // 1851 -> 1850 (without the markup it would be 1230)
    assert.deepEqual(kc({ projectCost: 1000, stdMarkup: 2 }), { unit: 2000, known: true });
  });
  it('the floor mode defaults to list', () => {
    assert.deepEqual(R.standardUnit({ kind: 'kc', projectCost: 1000, stdMarkup: 2, listAuto: 1830, quoted: 5 }), { unit: 1830, known: true });
  });
  it('"list" is read as a configured line as well', () => {
    assert.deepEqual(R.standardUnit({ kind: 'list', floorMode: 'list', projectCost: 1000, stdMarkup: 2, listAuto: 1830, quoted: 5 }), { unit: 1830, known: true });
  });
  it('a list auto price that is zero or not a number does not make a line list-priced', () => {
    assert.deepEqual(kc({ listAuto: 0 }), { unit: 2000, known: true });
    assert.deepEqual(kc({ listAuto: null }), { unit: 2000, known: true });
  });
  it('a configured line with no cost has no basis: its quoted price, cost unknown', () => {
    assert.deepEqual(kc({ projectCost: 0 }), { unit: 777, known: false });
    assert.deepEqual(kc({ projectCost: null }), { unit: 777, known: false });
    assert.deepEqual(kc({ projectCost: undefined }), { unit: 777, known: false });
  });
  it('a catalogue or website line counts at its catalogue / website price, whatever cost is on file', () => {
    assert.deepEqual(R.standardUnit({ kind: 'catalogue', projectCost: 1000, stdMarkup: 2, cataloguePrice: 480, quoted: 777 }), { unit: 480, known: true });
    assert.deepEqual(R.standardUnit({ kind: 'website', cataloguePrice: 520, quoted: 777 }), { unit: 520, known: true });
  });
  it('a catalogue line with no catalogue price has no basis', () => {
    assert.deepEqual(R.standardUnit({ kind: 'catalogue', projectCost: 1000, stdMarkup: 2, quoted: 777 }), { unit: 777, known: false });
    assert.deepEqual(R.standardUnit({ kind: 'catalogue', cataloguePrice: 0, quoted: 777 }), { unit: 777, known: false });
  });
  it('anything else has no basis; a missing quoted price counts as zero', () => {
    assert.deepEqual(R.standardUnit({ kind: 'custom', projectCost: 1000, stdMarkup: 2, quoted: 55 }), { unit: 55, known: false });
    assert.deepEqual(R.standardUnit({ kind: 'custom' }), { unit: 0, known: false });
    assert.deepEqual(R.standardUnit({}), { unit: 0, known: false });
    assert.deepEqual(R.standardUnit(), { unit: 0, known: false });
  });
});

describe('belowMarkupThreshold and belowMarkup: the discount warning (Q64)', () => {
  it('list mode with a list price: the list price is the floor', () => {
    assert.equal(R.belowMarkupThreshold({ floorMode: 'list', listPrice: 1830, projectCost: 1000, stdMarkup: 2 }), 1830);
  });
  it('formula mode: cost x the standard markup, nearest 10, even when there is a list price', () => {
    assert.equal(R.belowMarkupThreshold({ floorMode: 'formula', listPrice: 1830, projectCost: 1000, stdMarkup: 2 }), 2000);
    assert.equal(R.belowMarkupThreshold({ floorMode: 'formula', listPrice: 1830, projectCost: 1234, stdMarkup: 1.5 }), 1850);   // 1851
  });
  it('list mode with no list price (or an empty one): the formula floor', () => {
    assert.equal(R.belowMarkupThreshold({ floorMode: 'list', listPrice: null, projectCost: 1000, stdMarkup: 2 }), 2000);
    assert.equal(R.belowMarkupThreshold({ floorMode: 'list', listPrice: 0, projectCost: 1000, stdMarkup: 2 }), 2000);
    assert.equal(R.belowMarkupThreshold({ floorMode: 'list', projectCost: 1000, stdMarkup: 2 }), 2000);
  });
  it('the floor mode defaults to list', () => {
    assert.equal(R.belowMarkupThreshold({ listPrice: 1830, projectCost: 1000, stdMarkup: 2 }), 1830);
  });
  it('a typed price is below the floor only when it is lower (equal is not below)', () => {
    assert.equal(R.belowMarkup(1829, 1830), true);
    assert.equal(R.belowMarkup(1830, 1830), false);
    assert.equal(R.belowMarkup(1831, 1830), false);
  });
});

describe('discountCap: the quote may not go below its true cost', () => {
  it('pre-discount total minus the true cost', () => {
    assert.equal(R.discountCap(1000, 600), 400);
    assert.equal(R.discountCap(1000, 1000), 0);
  });
  it('never below zero (a quote already under its cost has no room to discount)', () => {
    assert.equal(R.discountCap(500, 800), 0);
    assert.equal(R.discountCap(0, 10), 0);
  });
});

describe('approvalRequired: when a quote must go to the President (section 1.3 item 1)', () => {
  const base = { role: 'sales', reviewOpen: false, net: 1000, standardTotal: 1000, costKnown: true, approvalBelowStandard: 'force', approveAll: false, covered: false };
  const call = o => R.approvalRequired(Object.assign({}, base, o));
  const none = { required: false, locked: false, reason: '', reasons: [], preTick: false };

  it('a neutral quote needs no approval', () => {
    assert.deepEqual(call({}), none);
  });
  it('a line that needs review forces it, and locks the tick, for every role but the President', () => {
    ['sales', 'manager', 'purchasing'].forEach(role => {
      const r = call({ role, reviewOpen: true });
      assert.equal(r.required, true, role);
      assert.equal(r.locked, true, role);
      assert.deepEqual(r.reasons, ['review'], role);
      assert.match(r.reason, /needs review/, role);
    });
  });
  it('the President is never forced and never locked (he is the approver)', () => {
    const r = call({ role: 'president', reviewOpen: true, net: 900, approveAll: true });
    assert.deepEqual(r, Object.assign({}, none, { preTick: false }));
    assert.equal(r.locked, false);
  });
  it('a quote below its standard total forces it when the setting is force (the default)', () => {
    const r = call({ net: 999.99 });                                              // one centavo under
    assert.equal(r.required, true);
    assert.deepEqual(r.reasons, ['below-standard']);
    assert.equal(call({ net: 900, approvalBelowStandard: undefined }).required, true);
  });
  it('...is only pre-ticked, not locked, when the setting is tick', () => {
    const r = call({ net: 900, approvalBelowStandard: 'tick' });
    assert.equal(r.required, false);
    assert.equal(r.locked, false);
    assert.equal(r.preTick, true);
    assert.equal(call({ net: 1000, approvalBelowStandard: 'tick' }).preTick, false);
    assert.equal(call({ net: 900, approvalBelowStandard: 'tick', role: 'president' }).preTick, false);
  });
  it('a total equal to the standard total is not below it, and float noise does not make it so', () => {
    assert.equal(call({ net: 1000 }).required, false);
    assert.equal(call({ net: 999.9999999999999 }).required, false);                // the same centavo
    assert.equal(call({ net: 1000.01 }).required, false);
  });
  it('approveAll forces it for everyone but the President', () => {
    const r = call({ approveAll: true });
    assert.equal(r.required, true);
    assert.deepEqual(r.reasons, ['approve-all']);
    assert.equal(call({ approveAll: true, role: 'president' }).required, false);
  });
  it('several reasons: all named, in the order review, below standard, approve all', () => {
    const r = call({ reviewOpen: true, net: 900, approveAll: true });
    assert.deepEqual(r.reasons, ['review', 'below-standard', 'approve-all']);
    assert.equal(r.reason.split('; ').length, 3);
    assert.match(r.reason, /^a line needs review; /);
  });
  it('a quote the last approval still covers needs none, whatever else is true', () => {
    assert.deepEqual(call({ covered: true, reviewOpen: true, net: 900, approveAll: true }), none);
  });
  it('whether the cost is known does not change the forced rule', () => {
    assert.equal(call({ costKnown: false, net: 900 }).required, true);
    assert.equal(call({ costKnown: false }).required, false);
  });
  it('an unknown role is treated like Sales, and junk never throws', () => {
    assert.equal(call({ role: undefined, reviewOpen: true }).required, true);
    assert.deepEqual(R.approvalRequired(), none);
    assert.deepEqual(R.approvalRequired({}), none);
  });
});

describe('needsReapproval: reopening an approved quote keeps the approval (Q65, section 1.3 item 3)', () => {
  const nr = (net, lastApprovedNet, standardTotal, costKnown) => R.needsReapproval({ net, lastApprovedNet, standardTotal, costKnown });
  it('no approval to carry: the rules of approvalRequired apply, so it needs one', () => {
    assert.equal(nr(1000, undefined, 1500, true), true);
    assert.equal(nr(1000, null, 1500, true), true);
    assert.equal(nr(1000, NaN, 1500, true), true);
    assert.equal(nr(1000, 'a lot', 1500, true), true);
  });
  it('a total at or above the approved one never needs it again, whatever changed (even below the standard total)', () => {
    assert.equal(nr(1100, 1000, 1500, true), false);     // raised, still under the standard total 1500: no
    assert.equal(nr(1100, 1000, 1500, false), false);
    assert.equal(nr(1000, 1000, 1500, true), false);     // equal is not below
    assert.equal(nr(1000, 1000, 1500, false), false);
    assert.equal(nr(1000, 1000, 900, true), false);
  });
  it('cost known: lowered below the approved total needs it only when it is also below the standard total', () => {
    assert.equal(nr(900, 1000, 1200, true), true);       // 900 < 1000 and 900 < 1200
    assert.equal(nr(900, 1000, 800, true), false);       // lowered, but still above cost x 2 = 800
    assert.equal(nr(900, 1000, 900, true), false);       // equal to the standard total is not below it
  });
  it('cost unknown: lowered below the approved total needs it (the conservative default)', () => {
    assert.equal(nr(900, 1000, 800, false), true);
    assert.equal(nr(900, 1000, undefined, false), true);
    assert.equal(nr(900, 1000, 800, undefined), true);
  });
  it('cost said to be known but no standard total to compare with: treated as unknown', () => {
    assert.equal(nr(900, 1000, undefined, true), true);
  });
  it('compares in centavos: float noise is not a change', () => {
    assert.equal(nr(999.9999999999999, 1000, 1500, false), false);
    assert.equal(nr(1000, 1000.0000000000001, 1500, true), false);
    assert.equal(nr(999.98, 1000, 1500, false), true);
  });
  it('an unknown new total needs it', () => {
    assert.equal(nr(undefined, 1000, 1500, true), true);
  });
});

describe('approvalCovers: the approval still covers the quote', () => {
  it('no carry, no cover', () => {
    assert.equal(R.approvalCovers({ carry: null, net: 1100, standardTotal: 800, costKnown: true }), false);
    assert.equal(R.approvalCovers({ net: 1100 }), false);
  });
  it('a carry covers a quote at or above the approved total', () => {
    const carry = { lastApprovedNet: 1000 };
    assert.equal(R.approvalCovers({ carry, net: 1100, standardTotal: 1500, costKnown: true }), true);
    assert.equal(R.approvalCovers({ carry, net: 1000, standardTotal: 1500, costKnown: false }), true);
  });
  it('a carry covers a lowered quote only while it is not below the standard total (cost known)', () => {
    const carry = { lastApprovedNet: 1000 };
    assert.equal(R.approvalCovers({ carry, net: 900, standardTotal: 800, costKnown: true }), true);
    assert.equal(R.approvalCovers({ carry, net: 900, standardTotal: 1200, costKnown: true }), false);
  });
  it('a carry covers a lowered quote of unknown cost: no', () => {
    assert.equal(R.approvalCovers({ carry: { lastApprovedNet: 1000 }, net: 900, standardTotal: 800, costKnown: false }), false);
  });
  it('a carry with no approved total covers nothing', () => {
    assert.equal(R.approvalCovers({ carry: {}, net: 1100, standardTotal: 800, costKnown: true }), false);
  });
});

describe('shouldHold: a filed quote keeps its stored price while the formula price has moved (section 3.5 rule 2)', () => {
  const hold = o => R.shouldHold(Object.assign({ fromFiled: true, basis: 'configured', stored: 1500, fresh: 1600 }, o));
  it('holds a configured line from a filed quote whose price differs', () => {
    assert.equal(hold({}), true);
    assert.equal(hold({ fresh: 1400 }), true);
  });
  it('a draft or template (not from a filed quote) follows the price list', () => {
    assert.equal(hold({ fromFiled: false }), false);
    assert.equal(hold({ fromFiled: undefined }), false);
  });
  it('a price the person typed (manual) is not a held price', () => {
    assert.equal(hold({ basis: 'manual' }), false);
    assert.equal(hold({ basis: undefined }), false);
  });
  it('nothing to hold when the prices agree or there is no stored price', () => {
    assert.equal(hold({ fresh: 1500 }), false);
    assert.equal(hold({ stored: 0 }), false);
    assert.equal(hold({ stored: undefined }), false);
    assert.equal(hold({ stored: -5 }), false);
  });
});

describe('aboveListReport: the items where cost x 2 is above the list price (Q64)', () => {
  const rows = [
    { code: 'A-1', list: 1000, projectCost: 600, stdMarkup: 2 },       // 1200 > 1000: above, by 200
    { code: 'B-1', list: 1000, projectCost: 500, stdMarkup: 2 },       // 1000 = 1000: not above
    { code: 'C-1', list: null, projectCost: 900, stdMarkup: 2 },       // no list price: nothing to compare
    { code: 'D-1', list: 1000, projectCost: 499, stdMarkup: 2 },       // 998: below
    { code: 'E-1', list: 1000, projectCost: 500.01, stdMarkup: 2 },    // 1000.02: above, by 0.02
    { code: 'F-1', list: 800, projectCost: 300, stdMarkup: 3 }         // 900 > 800: above, by 100
  ];
  it('lists only the rows above, with cost x markup and the difference, in the order given', () => {
    const out = R.aboveListReport(rows);
    assert.deepEqual(out.map(r => r.code), ['A-1', 'E-1', 'F-1']);
    assert.deepEqual(out.map(r => r.diff), [200, 0.02, 100]);
    assert.deepEqual(out.map(r => r.costTimesMarkup), [1200, 1000.02, 900]);
    assert.deepEqual(out.map(r => r.list), [1000, 1000, 800]);
  });
  it('an empty or missing list is an empty report, and junk rows are skipped', () => {
    assert.deepEqual(R.aboveListReport([]), []);
    assert.deepEqual(R.aboveListReport(), []);
    assert.deepEqual(R.aboveListReport([null, undefined, {}, { code: 'X', list: 'a', projectCost: 1, stdMarkup: 2 }]), []);
  });
});

describe('leadWorkingDays: the lead-time rule the page already uses', () => {
  it('never under 25 working days', () => {
    assert.equal(R.leadWorkingDays(0), 25);
    assert.equal(R.leadWorkingDays(19999), 25);       // 12 + 3 x 0 = 12 -> 25
    assert.equal(R.leadWorkingDays(99999), 25);       // 12 + 3 x 4 = 24 -> 25
  });
  it('12 working days plus 3 for each full 20000 of materials, once that passes 25', () => {
    assert.equal(R.leadWorkingDays(100000), 27);      // 12 + 3 x 5 = 27
    assert.equal(R.leadWorkingDays(139999), 30);      // floor(6.99995) = 6: 12 + 18
    assert.equal(R.leadWorkingDays(140000), 33);      // 12 + 3 x 7
  });
  it('junk is zero materials', () => {
    [undefined, null, NaN, -5, 'x'].forEach(m => assert.equal(R.leadWorkingDays(m), 25, String(m)));
  });
});

describe('nearestStd: the standard length nearest to the configured one (Addendum 1 A1)', () => {
  const STD = [900, 1200, 1500, 1800];
  it('an exact standard length is itself', () => {
    STD.forEach(l => assert.equal(R.nearestStd(l, STD), l));
  });
  it('otherwise the nearer one, below or above', () => {
    assert.equal(R.nearestStd(1000, STD), 900);        // 100 from 900, 200 from 1200
    assert.equal(R.nearestStd(1100, STD), 1200);       // 200 from 900, 100 from 1200
    assert.equal(R.nearestStd(1349, STD), 1200);       // 149 from 1200, 151 from 1500
    assert.equal(R.nearestStd(1351, STD), 1500);
    assert.equal(R.nearestStd(1790, STD), 1800);
  });
  it('on a tie the SHORTER length wins', () => {
    assert.equal(R.nearestStd(1050, STD), 900);        // 150 from 900, 150 from 1200
    assert.equal(R.nearestStd(1350, STD), 1200);       // 150 from 1200, 150 from 1500
    assert.equal(R.nearestStd(1650, STD), 1500);       // 150 from 1500, 150 from 1800
  });
  it('the order of the list does not matter', () => {
    const shuffled = [1800, 900, 1500, 1200];
    [1000, 1050, 1350, 1650, 2000].forEach(l => assert.equal(R.nearestStd(l, shuffled), R.nearestStd(l, STD), String(l)));
  });
  it('beyond either end it is the end', () => {
    assert.equal(R.nearestStd(300, STD), 900);
    assert.equal(R.nearestStd(5000, STD), 1800);
  });
  it('a single standard length is always chosen', () => {
    assert.equal(R.nearestStd(100, [2300]), 2300);
    assert.equal(R.nearestStd(9000, [2300]), 2300);
  });
  it('float noise at a tie is still a tie (compared to 0.01 mm)', () => {
    assert.equal(R.nearestStd(1050.000000001, STD), 900);
    assert.equal(R.nearestStd(1349.999999999, STD), 1200);
  });
  it('no standard length, or no length, is null', () => {
    assert.equal(R.nearestStd(1000, []), null);
    assert.equal(R.nearestStd(1000, undefined), null);
    assert.equal(R.nearestStd(1000, [null, 'x']), null);
    assert.equal(R.nearestStd(NaN, STD), null);
    assert.equal(R.nearestStd(undefined, STD), null);
    assert.equal(R.nearestStd('1000', STD), null);
  });
});

describe('lengthAdj: the per-metre rate on the length difference (Addendum 1 A1)', () => {
  it('a longer item adds (difference in metres) x the rate', () => {
    assert.equal(R.lengthAdj({ len: 1400, stdLen: 1200, perMetre: 1000 }), 200);     // 0.2 m x 1000
    assert.equal(R.lengthAdj({ len: 2200, stdLen: 1200, perMetre: 700 }), 700);      // exactly one metre longer: one rate
  });
  it('a shorter item takes it off', () => {
    assert.equal(R.lengthAdj({ len: 900, stdLen: 1200, perMetre: 1000 }), -300);     // 0.3 m x 1000, negative
  });
  it('the standard length itself adds nothing', () => {
    assert.equal(R.lengthAdj({ len: 1200, stdLen: 1200, perMetre: 1000 }), 0);
  });
  it('a fractional difference works in metres: 150 mm at 800 a metre is 120', () => {
    assert.equal(R.lengthAdj({ len: 1350, stdLen: 1200, perMetre: 800 }), 120);
  });
  it('a code with no per-metre rate, or an unknown length, adds nothing (the options carry the size)', () => {
    assert.equal(R.lengthAdj({ len: 1400, stdLen: 1200, perMetre: null }), 0);
    assert.equal(R.lengthAdj({ len: 1400, stdLen: 1200, perMetre: undefined }), 0);
    assert.equal(R.lengthAdj({ len: 1400, stdLen: 1200, perMetre: 'x' }), 0);
    assert.equal(R.lengthAdj({ len: 1400, stdLen: null, perMetre: 1000 }), 0);
    assert.equal(R.lengthAdj({ len: undefined, stdLen: 1200, perMetre: 1000 }), 0);
    assert.equal(R.lengthAdj({ len: 1400, stdLen: 1200, perMetre: 0 }), 0);
    assert.equal(R.lengthAdj(), 0);
  });
});

describe('listAdj: what is added to the formula price to reach the list-based price (Addendum 1 A1)', () => {
  it('without a per-metre rate: list price minus the formula price of the base model', () => {
    assert.deepEqual(R.listAdj({ list: 1000, sellBase: 600 }), { lengthAdj: 0, adj: 400 });
    assert.deepEqual(R.listAdj({ list: 1000, perMetre: null, len: 1500, stdLen: 1200, sellBase: 600 }), { lengthAdj: 0, adj: 400 });
  });
  it('with a per-metre rate the length difference is added: list + (len - std) / 1000 x rate - base', () => {
    // 1000 + 0.3 m x 100 - 600 = 430
    assert.deepEqual(R.listAdj({ list: 1000, perMetre: 100, len: 1500, stdLen: 1200, sellBase: 600 }), { lengthAdj: 30, adj: 430 });
    // shorter: 1000 - 0.2 m x 100 - 600 = 380
    assert.deepEqual(R.listAdj({ list: 1000, perMetre: 100, len: 1000, stdLen: 1200, sellBase: 600 }), { lengthAdj: -20, adj: 380 });
  });
  it('the unit is the list price + the length rate + what the options add by formula, nearest 10 (adding the adjustment to the formula price)', () => {
    // sell 800 (project cost 400 x 2), base at the same length 600: the options add 200; list 1000; 0.3 m x 100 = 30 -> 1000 + 30 + 200 = 1230
    const a = R.listAdj({ list: 1000, perMetre: 100, len: 1500, stdLen: 1200, sellBase: 600 });
    assert.equal(R.sellUnit({ projectCost: 400, markup: 2, listAdj: a.adj }), 1230);
    // an option that takes money off (sell 500, project cost 250 x 2): 1000 + 30 - 100 = 930
    assert.equal(R.sellUnit({ projectCost: 250, markup: 2, listAdj: a.adj }), 930);
    // the configuration IS the base model at its length (sell = base): the unit is the list price + the length rate, no more (the length is not counted twice)
    assert.equal(R.sellUnit({ projectCost: 300, markup: 2, listAdj: a.adj }), 1030);
    // the unit rounds once: 1000 + 30 + 4 = 1034 -> 1030, 1000 + 30 + 6 = 1036 -> 1040
    assert.equal(R.sellUnit({ projectCost: 302, markup: 2, listAdj: a.adj }), 1030);
    assert.equal(R.sellUnit({ projectCost: 303, markup: 2, listAdj: a.adj }), 1040);
  });
  it('the standard model at its own length sells at exactly the list price', () => {
    const a = R.listAdj({ list: 28500, perMetre: 100, len: 1200, stdLen: 1200, sellBase: 6000 });
    assert.equal(a.lengthAdj, 0);
    assert.equal(R.sellUnit({ projectCost: 3000, markup: 2, listAdj: a.adj }), 28500);   // sell = base = 6000: the unit is the list price
  });
});

describe('formulaBelowList: a formula price more than 10 % under the list-based price (Addendum 1 A1)', () => {
  const f = (formulaSell, listUnit, floorMode) => R.formulaBelowList({ formulaSell, listUnit, floorMode });
  it('only in formula floor mode, and only when the formula price is under 90 % of the list-based unit', () => {
    assert.equal(f(899, 1000, 'formula'), true);
    assert.equal(f(899.99, 1000, 'formula'), true);
    assert.equal(f(100, 1000, 'formula'), true);
  });
  it('exactly 90 % is not below, nor is anything above', () => {
    assert.equal(f(900, 1000, 'formula'), false);
    assert.equal(f(450, 500, 'formula'), false);
    assert.equal(f(449.99, 500, 'formula'), true);
    assert.equal(f(901, 1000, 'formula'), false);
    assert.equal(f(1500, 1000, 'formula'), false);
  });
  it('float noise at the 90 % line is not a warning (compared in centavos)', () => {
    assert.equal(f(899.999, 1000, 'formula'), false);
    assert.equal(f(900.001, 1000, 'formula'), false);
  });
  it('in list floor mode (or none given) it never shows, however far below', () => {
    assert.equal(f(100, 1000, 'list'), false);
    assert.equal(f(100, 1000, undefined), false);
    assert.equal(f(100, 1000, null), false);
    assert.equal(f(100, 1000, 'other'), false);
  });
  it('without a list-based unit above zero, or a formula price, there is nothing to compare', () => {
    assert.equal(f(100, 0, 'formula'), false);
    assert.equal(f(-5, -10, 'formula'), false);
    assert.equal(f(-100, -10, 'formula'), false);       // far under a list unit that is below zero: still nothing to compare
    assert.equal(f(-1, 0, 'formula'), false);
    assert.equal(f(100, undefined, 'formula'), false);
    assert.equal(f(undefined, 1000, 'formula'), false);
    assert.equal(f(NaN, 1000, 'formula'), false);
    assert.equal(R.formulaBelowList(), false);
  });
});

describe('the module itself', () => {
  it('is pure: the same input gives the same answer, and no input is changed', () => {
    const o = { role: 'sales', reviewOpen: true, net: 900, standardTotal: 1000, costKnown: true, approvalBelowStandard: 'force', approveAll: false, covered: false };
    const copy = JSON.parse(JSON.stringify(o));
    assert.deepEqual(R.approvalRequired(o), R.approvalRequired(o));
    assert.deepEqual(o, copy);
    const rows = [{ code: 'A', list: 1000, projectCost: 600, stdMarkup: 2 }];
    const rowsCopy = JSON.parse(JSON.stringify(rows));
    R.aboveListReport(rows);
    assert.deepEqual(rows, rowsCopy);
  });
  it('exports exactly the functions of spec 6.2', () => {
    assert.deepEqual(Object.keys(R).sort(), ['aboveListReport', 'approvalCovers', 'approvalRequired', 'belowMarkup', 'belowMarkupThreshold', 'bracketOfSection', 'discountCap',
      'formulaBelowList', 'leadWorkingDays', 'lengthAdj', 'listAdj', 'nearestStd', 'needsReapproval', 'r1', 'round10', 'sellUnit', 'shouldHold', 'standardUnit']);
    Object.values(R).forEach(f => assert.equal(typeof f, 'function'));
  });
});
