// tests/qb-spec-sheet.test.mjs — js/qb-spec-sheet.js, the pure helpers behind the SPEC SHEET the Quote Builder prints under every quote line
// (specs/QB-SELLING-QUOTE-SPEC.md §3.1 / §3.2 / Phase 1, owner rulings of 2026-11-05 in its §7).
//
// The module is UMD and pure (no DOM, no prices, never throws on junk), so it is required directly. The configured-line fixtures are built by the REAL
// QBConfigured.buildLine over the REAL family definitions, so the rows under test are the ones a quote line really carries (Material first, Construction last,
// finish / includes / excludes / lead time from the family data) — never a hand-copied imitation.
//
// WHAT IT PINS
//   1. rows()          Size first, then Material, the option rows, Construction (own row), Finish, extra rows, Includes / Not included, Lead time, notes — for a configured
//                      sink, a catalogue line with option specs, a custom line in the preparer's own wording (`specEdit`: one paragraph INSTEAD of the generated rows, even
//                      when empty), a line with finish / includes / excludes, and a legacy line with nothing (no rows at all). A lead time prints only in the ruled form
//                      "<N> working days" ("N working days min."); the legacy "14-21 days" never does (it would contradict the 25-working-days minimum).
//   2. html()          the <table class="spec-sheet"> string; every label and value goes through the CALLER's escaper (a "<" is never raw), a safe default exists, a
//                      newline becomes <br>, a line with no rows is ''.
//   3. completeness()  fabricated vs bought-in, the "photo" the caller knows about, the missing list in order; quality() (the weak lines, the strength out of 10);
//                      fabricatedWithoutSize() (the hard block of Verify & File).
//   4. the document text   docNotes() (the dimension legend only when a line has a size; the tolerance reference unless that term is off; the lead sentence from the
//                      largest ruled lead), summaryStrip() (every part, blank parts skipped, the KitchenShield part on its plan only), constructionBullets().
//   5. FINISH_LABELS / FINISH_ORDER / TEXT frozen with the ruled wording; the file is ES5, DOM-free, price-free, and never mutates what it is given.
//
// Mutation-tested in scratch copies of the repository (never the shared tree) — see the report of the phase: each of these must fail here: Size not first / after Material;
// Construction not last of the specs; the specEdit paragraph not replacing the generated rows (or an empty specEdit still printing them); a legacy lead string printing; html()
// ignoring the escaper; a "<" left raw; isFabricated without custom lines / ignoring pass-through; hasSize ignoring the numeric size; the photo argument ignored; the legend printed
// with no size; the tolerance reference printed when that term is off; the summary strip printing KitchenShield on the standard plan; FINISH_LABELS unfrozen or reworded.
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QS = require('../js/qb-spec-sheet.js');
const PF = require('../js/product-families.js');
const FAM = require('../js/qr-families.js');
const PC = require('../js/pricing-core.js');
const QB = require('../js/qb-configured.js');

const DEPS = { PF, PC, FAM, constants: {} };
const PRIMARIES = { prep_table: 'PW-001', sink: 'PW-004', dish_table: 'PW-029', stove: 'CE-001', wok_range: 'CE-006', cooking_line: 'CE-010', deck_oven: 'CE-012', hood: 'EX-001', cabinet: 'PW-015', wall_shelf: 'PW-023', rack: 'PW-010' };
const SIZES = { prep_table: { W: 1800, D: 700, H: 850 }, sink: { W: 2100, D: 700, H: 850 }, rack: { W: 1200, D: 500, H: 1800 }, hood: { W: 3000, D: 1000 } };
// a configured line exactly as the builder's "Add to Quote" makes it (an unpriced basis: the figures do not matter here, and this module never reads one)
const line = (id, config, size, extra) => {
  const f = FAM.families[id];
  const cfg = Object.assign({}, PF.defaultConfig(f), config || {});
  const it = QB.buildLine(DEPS, { family: f, primary: { id: PRIMARIES[id], category: 'prep_washing', formulaType: 'per_length' }, config: cfg, size: size || PF.standardDims(f, cfg), qty: 1, basis: { priced: false } });
  assert.ok(it, `buildLine refused ${id}`);
  return Object.assign(it, extra || {});
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const labels = (rows) => rows.map((r) => r.label);
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

describe('rows() — the order and the kinds of the spec sheet', () => {
  it('a configured sink: Size first, Material second, the option rows, then Construction — the last of the specs — then Finish, Includes, Not included and the ruled lead time', () => {
    const sink = line('sink', { basins: 3, faucet: 'prerinse' }, SIZES.sink);
    const rows = QS.rows(sink);
    assert.deepEqual(rows.map((r) => r.kind), ['size', 'spec', 'spec', 'spec', 'spec', 'spec', 'spec', 'construction', 'finish', 'includes', 'excludes', 'lead']);
    assert.deepEqual(labels(rows), ['Size', 'Material', 'Sinks', 'Sink position', 'Undershelf', 'Upper shelf', 'Faucet', 'Construction', 'Finish', 'Includes', 'Not included', 'Lead time']);
    assert.equal(rows[0].value, 'L2100 × W700 × H850 mm');
    assert.equal(rows[1].value, 'Stainless Steel 304 Food Grade');
    assert.equal(rows[7].value, 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelf, upper shelf and panels · square-tube posts with adjustable bullet feet');
    assert.equal(rows[8].value, 'Hairline finish');
    assert.equal(rows[9].value, '3 basins with waste fittings and strainers; pre-rinse spray faucet; adjustable bullet feet');
    assert.equal(rows[10].value, 'Water supply and drain line to the sink; angle valves');
    assert.equal(rows[11].value, '25 working days min.');
  });

  it('Construction is the LAST of the generated rows even when the specs arrive in another order, and Material comes first of them', () => {
    const it = { dims: 'L1 × W1 mm', specs: [{ label: 'Construction', value: 'C' }, { label: 'Colour', value: 'grey' }, { label: 'Material', value: 'M' }, { label: 'Fit', value: 'x' }] };
    assert.deepEqual(QS.rows(it).map((r) => [r.label, r.kind]), [['Size', 'size'], ['Material', 'spec'], ['Colour', 'spec'], ['Fit', 'spec'], ['Construction', 'construction']]);
  });

  it('a catalogue line with option specs: Size, then its rows in order; nothing is invented (no Construction, no Finish, no Includes, no lead time from "7-10 days")', () => {
    const cat = { id: 'PW-004', name: 'SS Wash Sink (Single) with Gooseneck Faucet', dims: 'L500 × W500 × H850 mm', specs: [{ label: 'Basin Depth', value: '300mm' }, { label: 'Faucet Type', value: 'Gooseneck' }], specStr: '300mm, Gooseneck', leadTime: '7-10 days', formulaType: 'per_length' };
    assert.deepEqual(QS.rows(cat), [
      { label: 'Size', value: 'L500 × W500 × H850 mm', kind: 'size' },
      { label: 'Basin Depth', value: '300mm', kind: 'spec' },
      { label: 'Faucet Type', value: 'Gooseneck', kind: 'spec' }]);
  });

  it('`specEdit` (the preparer\'s own wording) is ONE paragraph with no label INSTEAD of Material / the options / Construction; the size, finish, includes and lead time still print', () => {
    const it = line('sink', {}, SIZES.sink, { specEdit: 'Custom: 3 basins,\nSS304 1.5 mm' });
    const rows = QS.rows(it);
    assert.deepEqual(rows.map((r) => r.kind), ['size', 'spec', 'finish', 'includes', 'excludes', 'lead']);
    assert.deepEqual(rows[1], { label: '', value: 'Custom: 3 basins,\nSS304 1.5 mm', kind: 'spec' });
    assert.equal(rows.some((r) => r.label === 'Material' || r.label === 'Construction'), false);
  });

  it('a DEFINED but empty `specEdit` (a cleared Specs cell, or a fresh custom line) prints no spec rows at all — as it always did', () => {
    const it = line('rack', {}, SIZES.rack, { specEdit: '   ' });
    assert.deepEqual(QS.rows(it).map((r) => r.kind), ['size', 'finish', 'includes', 'lead']);
    assert.deepEqual(QS.rows({ id: 'CUSTOM', name: 'New custom item', dims: '', specs: [], specEdit: '' }), []);
  });

  it('finish, extra rows, includes, not included and notes: the order, the wording ("Hairline finish"), "; " between phrases, the first letter capital, empty values skipped', () => {
    const it = { dims: 'L1200 × W600 mm', specs: [{ label: 'Material', value: 'SS304' }], finish: 'mirror', specLines: [{ label: 'Capacity', value: '2 x 10 L' }, { label: 'Power', value: '' }, { label: '', value: 'Made to drawing' }],
      includes: ['faucet', ' drain basket ', ''], excludes: ['water supply'], leadTime: '25 working days', notes: 'Near the loading door' };
    assert.deepEqual(QS.rows(it), [
      { label: 'Size', value: 'L1200 × W600 mm', kind: 'size' },
      { label: 'Material', value: 'SS304', kind: 'spec' },
      { label: 'Finish', value: 'Mirror finish', kind: 'finish' },
      { label: 'Capacity', value: '2 x 10 L', kind: 'extra' },
      { label: '', value: 'Made to drawing', kind: 'extra' },
      { label: 'Includes', value: 'Faucet; drain basket', kind: 'includes' },
      { label: 'Not included', value: 'Water supply', kind: 'excludes' },
      { label: 'Lead time', value: '25 working days min.', kind: 'lead' },
      { label: '', value: 'Near the loading door', kind: 'note' }]);
  });

  it('a legacy line with nothing to say has NO rows (only its name prints), whatever else it carries: prices, a cost, a "—" lead time, a section', () => {
    assert.deepEqual(QS.rows({ id: 'RF-004', category: 'refrigeration', name: 'Undercounter Chiller', dims: '', specs: [], specStr: '', qty: 1, unit: 'pc', unitPrice: 62000, amount: 62000, leadTime: '14-21 days', formulaType: 'fixed' }), []);
    assert.deepEqual(QS.rows({ leadTime: '—' }), []);
    assert.deepEqual(QS.rows({}), []);
  });

  it('only the ruled lead time prints: "<N> working days" (singular "1 working day"), never an old estimate such as "14-21 days", "in-stock" or "—"', () => {
    const lead = (leadTime) => QS.rows({ leadTime }).filter((r) => r.kind === 'lead').map((r) => r.value);
    assert.deepEqual(lead('25 working days'), ['25 working days min.']);
    assert.deepEqual(lead(' 30 Working Days '), ['30 working days min.']);
    assert.deepEqual(lead('1 working day'), ['1 working day min.']);
    for (const legacy of ['14-21 days', '7-10 days', 'in-stock', '—', '', '0 working days', '25 days', '25 working days min.', 25, null, undefined, { n: 25 }]) assert.deepEqual(lead(legacy), [], String(legacy));
    assert.deepEqual(QS.leadInfo('25 working days'), { n: 25, text: '25 working days min.' });
    assert.equal(QS.leadInfo('14-21 days'), null);
  });

  it('`leadOn: false` (a quotation "as issued" under the earlier timeline rule) leaves the lead-time row out and nothing else; any other value of the option changes nothing', () => {
    const sink = line('sink', { basins: 3, faucet: 'prerinse' }, SIZES.sink);
    const all = QS.rows(sink), off = QS.rows(sink, { leadOn: false });
    assert.deepEqual(off, all.filter((r) => r.kind !== 'lead'));
    assert.ok(all.some((r) => r.kind === 'lead') && !off.some((r) => r.kind === 'lead'));
    for (const opt of [undefined, null, {}, { leadOn: true }, { leadOn: undefined }, { leadOn: 0 }, { leadOn: '' }, { leadOn: null }, { view: 'client', bac: false }]) assert.deepEqual(QS.rows(sink, opt), all, JSON.stringify(opt));
    assert.equal(QS.html(sink, { leadOn: false }, esc).includes('Lead time'), false);
    assert.equal(QS.html(sink, { leadOn: true }, esc).includes('<td class="ss-v">25 working days min.</td>'), true);
    assert.equal(QS.html(sink, undefined, esc), QS.html(sink, {}, esc));
  });

  it('a text `material` is the Material row of a line whose specs carry none (the legacy products); an object material (the master\'s gauges) is NEVER printed', () => {
    assert.deepEqual(QS.rows({ material: 'SS304 stainless steel' }).map((r) => [r.label, r.value]), [['Material', 'SS304 stainless steel']]);
    assert.deepEqual(QS.rows({ material: { grade: 'SS304', topGauge: '1.2mm', finish: 'No.4 brushed' } }), []);
    assert.deepEqual(QS.rows({ material: 'x', specs: [{ label: 'Material', value: 'Stainless Steel 304 Food Grade' }] }).map((r) => r.value), ['Stainless Steel 304 Food Grade']);
  });

  it('a "3 run(s)" line is labelled Runs, not Size', () => {
    assert.deepEqual(QS.rows({ dims: '3 run(s)' }), [{ label: 'Runs', value: '3 run(s)', kind: 'size' }]);
  });

  it('never throws on junk and never mutates what it is given (a deeply frozen line, then rubbish)', () => {
    const it = deepFreeze(line('stove', { addons: ['griddle'] }, { W: 1500, D: 800, H: 850 }));
    assert.doesNotThrow(() => { QS.rows(it); QS.html(it, {}, esc); QS.completeness(it); QS.quality([it]); });
    for (const junk of [null, undefined, 5, 'x', [], true, { specs: 'x', includes: 'x', excludes: 5, specLines: [null, 5, 'x'], finish: 7, leadTime: [], dims: 5, notes: {} }, { specs: [null, 5, { label: {}, value: [] }] }]) {
      assert.doesNotThrow(() => { QS.rows(junk); QS.html(junk); QS.completeness(junk); QS.isFabricated(junk); QS.hasSize(junk); }, String(JSON.stringify(junk)));
    }
    assert.deepEqual(QS.rows(null), []);
    assert.equal(QS.html(undefined), '');
  });
});

describe('html() — the table, escaped by the CALLER\'s escaper', () => {
  it('is a two-column <table class="spec-sheet"> with one row per rows() row, a labelled row and a full-width row for a paragraph / note', () => {
    const it = { dims: 'L1 mm', specs: [{ label: 'Material', value: 'SS304' }], notes: 'a note' };
    assert.equal(QS.html(it, {}, esc),
      '<table class="spec-sheet">' +
      '<tr class="ss-row ss-size"><td class="ss-l">Size</td><td class="ss-v">L1 mm</td></tr>' +
      '<tr class="ss-row ss-spec"><td class="ss-l">Material</td><td class="ss-v">SS304</td></tr>' +
      '<tr class="ss-row ss-note"><td class="ss-v" colspan="2">a note</td></tr></table>');
  });

  it('every label and value goes through the supplied escaper — a "<" in a spec, a name, an include or a note is never raw — and a newline becomes <br>', () => {
    const it = { dims: '<b>L1</b>', specs: [{ label: '<i>Colour', value: '<script>alert(1)</script>' }], includes: ['a <img src=x onerror=1>'], excludes: ['"quoted" & more'], notes: 'x<y\nsecond line', finish: 'hairline' };
    const out = QS.html(it, {}, esc);
    assert.equal(/<(script|img|b|i)[ >]/.test(out.replace(/<\/?(table|tr|td)\b[^>]*>/g, '')), false, out);
    assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(out.includes('A &lt;img src=x onerror=1&gt;'), 'the include is escaped (and capitalised)');
    assert.ok(out.includes('&quot;quoted&quot; &amp; more'));
    assert.ok(out.includes('x&lt;y<br>second line'));
    // the caller's escaper is really the one used: a marker escaper marks every piece
    const seen = [];
    QS.html({ dims: 'D', specs: [{ label: 'L', value: 'V' }] }, {}, (s) => { seen.push(s); return '[' + s + ']'; });
    assert.ok(seen.includes('D') && seen.includes('Size') && seen.includes('L') && seen.includes('V'));
    assert.ok(QS.html({ dims: 'D' }, {}, (s) => '[' + s + ']').includes('<td class="ss-v">[D]</td>'));
  });

  it('with no escaper it still escapes (a safe default) and a line with no rows is the empty string', () => {
    assert.ok(QS.html({ dims: '<x>' }).includes('&lt;x&gt;'));
    assert.equal(QS.html({ id: 'RF-004', name: 'Chiller' }, {}, esc), '');
  });
});

describe('FINISH_LABELS / FINISH_ORDER / TEXT — the ruled wording, frozen', () => {
  it('hairline is the standard and comes first; the labels are the ruling\'s words; nothing can be added or changed at run time', () => {
    assert.deepEqual([...QS.FINISH_ORDER], ['hairline', 'brushed', 'mirror', 'satin']);
    assert.deepEqual({ ...QS.FINISH_LABELS }, { hairline: 'Hairline finish', brushed: 'Brushed finish', mirror: 'Mirror finish', satin: 'Satin finish' });
    assert.equal(Object.isFrozen(QS.FINISH_LABELS), true);
    assert.equal(Object.isFrozen(QS.FINISH_ORDER), true);
    assert.equal(Object.isFrozen(QS.TEXT), true);
    assert.throws(() => { 'use strict'; QS.FINISH_LABELS.matte = 'Matte finish'; }, TypeError);
    // the finish ids are exactly the ones the family build accepts as `finishDefault`
    assert.deepEqual([...QS.FINISH_ORDER], require('../scripts/build-catalogue.js').FINISH_IDS);
  });

  it('only a known finish prints: an unknown id, a label, a number or a prototype name is "not stated"', () => {
    for (const bad of ['matte', 'Hairline finish', 'HAIRLINE', '', 5, null, undefined, 'constructor', '__proto__', 'toString']) assert.equal(QS.rows({ finish: bad }).some((r) => r.kind === 'finish'), false, String(bad));
    for (const f of ['hairline', 'brushed', 'mirror', 'satin']) assert.equal(QS.rows({ finish: f }).find((r) => r.kind === 'finish').value, QS.FINISH_LABELS[f]);
  });
});

describe('completeness(), quality() and fabricatedWithoutSize() — what a line still lacks', () => {
  it('isFabricated: a configured line, a per-length / per-area / per-run / configurable catalogue line and a custom line are made to order; a fixed catalogue line, a fee line, a pass-through or "no costing" line are not', () => {
    for (const yes of [{ familyId: 'sink' }, { formulaType: 'per_length' }, { formulaType: 'per_area' }, { formulaType: 'per_run' }, { formulaType: 'configurable' }, { id: 'CUSTOM' }, { id: 'CUSTOM', formulaType: 'fixed' }]) assert.equal(QS.isFabricated(yes), true, JSON.stringify(yes));
    for (const no of [{ formulaType: 'fixed' }, { id: 'RF-004' }, { id: 'MISCFEE', formulaType: 'per_length' }, { familyId: 'sink', passThrough: true }, { id: 'CUSTOM', passThrough: true }, { id: 'CUSTOM', noCosting: true }, null, 5, {}]) assert.equal(QS.isFabricated(no), false, JSON.stringify(no));
  });

  it('hasSize: a dims text, or a numeric size above zero — not an empty size, not a zero, not a string', () => {
    assert.equal(QS.hasSize({ dims: 'L100 mm' }), true);
    assert.equal(QS.hasSize({ size: { W: 900 } }), true);
    assert.equal(QS.hasSize({ size: { H: 850.5 } }), true);
    for (const no of [{}, { dims: '  ' }, { size: {} }, { size: { W: 0 } }, { size: { W: '900' } }, { size: { W: NaN } }, { size: null }, null, undefined]) assert.equal(QS.hasSize(no), false, JSON.stringify(no));
  });

  it('a complete configured line (size, specs, finish, ruled lead) lacks only a photo until one is linked; a made-to-order line with nothing lacks everything, in order', () => {
    const sink = line('sink', {}, SIZES.sink);
    assert.deepEqual(QS.completeness(sink), { score: 0.8, missing: ['photo'], fabricated: true });
    assert.deepEqual(QS.completeness(sink, { hasPhoto: true }), { score: 1, missing: [], fabricated: true });
    assert.deepEqual(QS.completeness({ ...sink, photoUrl: 'https://firebasestorage.googleapis.com/x' }), { score: 1, missing: [], fabricated: true });
    assert.deepEqual(QS.completeness({ id: 'CUSTOM', name: 'New custom item', dims: '', specs: [], specEdit: '' }), { score: 0, missing: ['size', 'specs', 'finish', 'lead', 'photo'], fabricated: true });
  });

  it('`leadOn: false` takes the lead time out of what a made-to-order line needs (the timeline rule it was issued under prints none) — in completeness() and, through it, in quality(); a bought-in line is unaffected', () => {
    const custom = { id: 'CUSTOM', name: 'Gate', dims: 'L1 mm', specEdit: 'Mild steel', finish: 'satin', leadTime: '' };
    assert.deepEqual(QS.completeness(custom, { hasPhoto: true }), { score: 0.8, missing: ['lead'], fabricated: true });
    assert.deepEqual(QS.completeness(custom, { hasPhoto: true, leadOn: false }), { score: 1, missing: [], fabricated: true });
    assert.deepEqual(QS.completeness({ id: 'CUSTOM' }, { leadOn: false }).missing, ['size', 'specs', 'finish', 'photo']);
    for (const opt of [{ leadOn: true }, { leadOn: undefined }, { leadOn: 0 }, { leadOn: '' }, { leadOn: null }, {}, undefined]) assert.deepEqual(QS.completeness({ id: 'CUSTOM' }, opt).missing, ['size', 'specs', 'finish', 'lead', 'photo'], JSON.stringify(opt));
    const bought = { id: 'RF-004', specLines: [{ label: 'Capacity', value: '200 L' }], formulaType: 'fixed' };
    assert.deepEqual(QS.completeness(bought, { leadOn: false }), QS.completeness(bought));
    const q = QS.quality([custom, { ...custom, id: 'CUSTOM' }], { hasPhoto: () => true, leadOn: false });
    assert.deepEqual([q.outOf10, q.counts.lead, q.lines.map((l) => l.missing.length)], [10, 0, [0, 0]]);
    assert.deepEqual(QS.quality([custom], { hasPhoto: () => true }).counts.lead, 1);
  });

  it('a bought-in line needs only specs and a photo: it may skip size, finish and lead time', () => {
    const chiller = { id: 'RF-004', name: 'Undercounter Chiller', dims: '', specs: [], formulaType: 'fixed', leadTime: '14-21 days' };
    assert.deepEqual(QS.completeness(chiller), { score: 0, missing: ['specs', 'photo'], fabricated: false });
    assert.deepEqual(QS.completeness({ ...chiller, specLines: [{ label: 'Capacity', value: '200 L' }] }), { score: 0.5, missing: ['photo'], fabricated: false });
    assert.deepEqual(QS.completeness({ ...chiller, specLines: [{ label: 'Capacity', value: '200 L' }] }, { hasPhoto: true }), { score: 1, missing: [], fabricated: false });
  });

  it('a Specs paragraph (specEdit) counts as specs; an empty one does not; a finish must be a known one', () => {
    assert.equal(QS.completeness({ id: 'CUSTOM', dims: 'L1 mm', specEdit: 'Materials: SS304 pipe' }).missing.includes('specs'), false);
    assert.equal(QS.completeness({ id: 'CUSTOM', dims: 'L1 mm', specEdit: '' }).missing.includes('specs'), true);
    assert.equal(QS.completeness({ id: 'CUSTOM', finish: 'matte' }).missing.includes('finish'), true);
    assert.equal(QS.completeness({ id: 'CUSTOM', finish: 'satin' }).missing.includes('finish'), false);
  });

  it('quality(): fee lines are not counted; the score is the average of the lines; `weak` lists the lines lacking a size, specs or a finish (not a photo or lead time); counts say how many lack each thing', () => {
    const items = [
      line('sink', {}, SIZES.sink),                                                                            // 4/5: only the photo
      line('rack', {}, SIZES.rack, { finish: '' }),                                                            // 3/5: finish + photo
      { id: 'RF-004', name: 'Chiller', specs: [], formulaType: 'fixed' },                                      // 0/2
      { id: 'MISCFEE', name: 'Delivery', amount: 5000 },
      { id: 'CUSTOM', name: 'Shelf', dims: '', specs: [], specEdit: '' }                                       // 0/5
    ];
    const q = QS.quality(items, { hasPhoto: (it, i) => i === 0 });
    assert.equal(q.count, 4);
    assert.deepEqual(q.lines.map((l) => l.idx), [0, 1, 2, 4]);
    assert.deepEqual(q.lines.map((l) => +l.score.toFixed(2)), [1, 0.6, 0, 0]);
    assert.equal(+q.score.toFixed(4), 0.4);
    assert.equal(q.outOf10, 4);
    assert.deepEqual(q.weak, [{ idx: 1, missing: ['finish'] }, { idx: 2, missing: ['specs'] }, { idx: 4, missing: ['size', 'specs', 'finish'] }]);
    assert.deepEqual(q.counts, { size: 1, specs: 2, finish: 2, lead: 1, photo: 3 });
    assert.deepEqual(QS.quality([]), { score: 0, outOf10: 0, count: 0, lines: [], weak: [], counts: { size: 0, specs: 0, finish: 0, lead: 0, photo: 0 } });
    assert.equal(QS.quality(null).count, 0);
    // the strength rounds to the nearest whole number out of 10 (an average of two thirds is 7/10, not 6/10)
    const thirds = QS.quality([line('sink', {}, SIZES.sink), line('rack', {}, SIZES.rack, { finish: '' }), line('rack', {}, SIZES.rack, { finish: '' })]);
    assert.equal(+thirds.score.toFixed(4), 0.6667);
    assert.equal(thirds.outOf10, 7);
  });

  it('fabricatedWithoutSize(): only made-to-order lines that state no size, with their position and name — the HARD block of Verify & File', () => {
    const items = [line('sink', {}, SIZES.sink), { id: 'CUSTOM', name: 'Gate', dims: '' }, { id: 'RF-004', name: 'Chiller', formulaType: 'fixed' }, { id: 'CUSTOM', name: 'Railing', dims: '3 run(s)' }, { id: 'CUSTOM', name: 'Rail', passThrough: true }, { familyId: 'rack', name: ' Rack ', size: {}, dims: '' }];
    assert.deepEqual(QS.fabricatedWithoutSize(items), [{ idx: 1, name: 'Gate' }, { idx: 5, name: 'Rack' }]);
    assert.deepEqual(QS.fabricatedWithoutSize([{ id: 'CUSTOM', dims: 'L1200 × W600 mm' }]), []);
    assert.deepEqual(QS.fabricatedWithoutSize(null), []);
  });
});

describe('the once-per-document text — docNotes(), summaryStrip(), constructionBullets()', () => {
  it('docNotes: the dimension legend (and the tolerance reference) only when a line has a size, the lead sentence from the LARGEST ruled lead; a "run(s)" line is no size', () => {
    const n = QS.docNotes([line('sink', {}, SIZES.sink)]);
    assert.equal(n.dims, 'Dimensions are Length × Width × Height in mm (hoods: Length × Depth). Fabricated dimensions carry the ±5 mm tolerance stated in the terms.');
    assert.equal(n.lead, 'Lead time: 25 working days minimum, from downpayment and approved drawings.');
    assert.equal(n.leadMin, 25);
    assert.equal(QS.docNotes([{ leadTime: '25 working days' }, { leadTime: '30 working days' }, { leadTime: '14-21 days' }]).lead, 'Lead time: 30 working days minimum, from downpayment and approved drawings.');
    const none = QS.docNotes([{ id: 'RF-004', dims: '', leadTime: '14-21 days' }, { dims: '3 run(s)' }, { id: 'MISCFEE', dims: 'L1 mm', leadTime: '25 working days' }]);
    assert.deepEqual(none, { dims: '', lead: '', leadMin: 0 });
    assert.deepEqual(QS.docNotes(null), { dims: '', lead: '', leadMin: 0 });
  });

  it('`leadOn: false` says nothing about a lead time (lead \'\' and leadMin 0 — so the strip drops its lead part too) while the dimension legend stays', () => {
    const items = [line('sink', {}, SIZES.sink), { leadTime: '30 working days' }];
    assert.deepEqual(QS.docNotes(items, { leadOn: false }), { dims: QS.docNotes(items).dims, lead: '', leadMin: 0 });
    assert.equal(QS.docNotes(items).leadMin, 30);
    for (const opt of [{ leadOn: true }, { leadOn: undefined }, { leadOn: 0 }, { leadOn: '' }, { leadOn: null }, {}, undefined, null]) assert.equal(QS.docNotes(items, opt).leadMin, 30, JSON.stringify(opt));
    assert.equal(QS.summaryStrip({ leadMin: QS.docNotes(items, { leadOn: false }).leadMin, warrantyOn: false }), '');
  });

  it('the tolerance reference is dropped when that term is switched off (it would say "stated in the terms" when it is not); the legend itself stays', () => {
    const on = QS.docNotes([{ dims: 'L1 mm' }], { toleranceOn: true }).dims;
    const off = QS.docNotes([{ dims: 'L1 mm' }], { toleranceOn: false }).dims;
    assert.ok(on.endsWith('stated in the terms.'));
    assert.equal(off, 'Dimensions are Length × Width × Height in mm (hoods: Length × Depth).');
  });

  it('summaryStrip: validity · payment · lead time · delivery · warranty, in that order, blank parts skipped', () => {
    assert.equal(QS.summaryStrip({ validDays: 30, downPct: '50', balanceMode: 'lump', leadMin: 25, deliveryMethod: 'Company delivery truck', warrantyPlan: 'service6' }),
      'Valid 30 days · 50% down payment, balance on completion · Lead time from 25 working days · Delivery: Company delivery truck · 6-month service warranty');
    assert.equal(QS.summaryStrip({ validDays: 120, downPct: '30', balanceMode: 'stagger3' }), 'Valid 120 days · 30% down payment, balance in 3 staggered payments · 6-month service warranty');
    assert.equal(QS.summaryStrip({ validDays: 30, downPct: '15', balanceMode: 'install12', warrantyOn: false }), 'Valid 30 days · 15% down payment, balance in 12 monthly installments');
    assert.equal(QS.summaryStrip({ validDays: 30, downCustom: true, balanceMode: 'lump' }), 'Valid 30 days · custom down payment, balance on completion · 6-month service warranty');
    assert.equal(QS.summaryStrip({ validDays: 30, milestones: 3, downPct: '40', balanceMode: 'lump' }), 'Valid 30 days · 3 payment milestones · 6-month service warranty');
    assert.equal(QS.summaryStrip({ milestones: 1 }), '1 payment milestone · 6-month service warranty');
    assert.equal(QS.summaryStrip({}), '6-month service warranty');
    assert.equal(QS.summaryStrip(null), '6-month service warranty');
    assert.equal(QS.summaryStrip({ warrantyOn: false }), '');
    assert.equal(QS.summaryStrip({ validDays: 'x', downPct: 'x', leadMin: 0, deliveryMethod: '   ' }), '6-month service warranty');
    // a down payment keeps up to two decimals (a 33.33% deposit is not "33%")
    assert.equal(QS.summaryStrip({ downPct: '33.33', balanceMode: 'lump', warrantyOn: false }), '33.33% down payment, balance on completion');
    assert.equal(QS.summaryStrip({ downPct: '12.5', warrantyOn: false }), '12.5% down payment');
  });

  it('summaryStrip: the KitchenShield part follows the full-kitchen plan ONLY — never the standard plan, never when the warranty is off', () => {
    assert.equal(QS.summaryStrip({ warrantyPlan: 'kitchenshield12' }), '6-month service warranty · 12-month PMS with KitchenShield™');
    for (const plan of ['service6', undefined, '', 'KITCHENSHIELD12', 'kitchenshield', null]) assert.equal(QS.summaryStrip({ warrantyPlan: plan }).includes('KitchenShield'), false, String(plan));
    assert.equal(QS.summaryStrip({ warrantyPlan: 'kitchenshield12', warrantyOn: false }), '');
  });

  it('constructionBullets: the distinct Construction sentences of the configured lines, led by the family title, in line order, de-duplicated; a line in the preparer\'s own wording and a catalogue line add none', () => {
    const a = line('sink', {}, SIZES.sink), b = line('sink', { basins: 2 }, { W: 1800, D: 700, H: 850 }), c = line('rack', {}, SIZES.rack), d = line('hood', {}, SIZES.hood);
    const custom = line('prep_table', {}, SIZES.prep_table, { specEdit: 'my words' });
    const out = QS.constructionBullets([a, b, custom, { id: 'RF-004', name: 'Chiller' }, c, d], (it) => ({ sink: 'Sink', rack: 'Rack', hood: 'Range hood' }[it.familyId]));
    assert.deepEqual(out.map((x) => x.title), ['Sink', 'Rack', 'Range hood'], 'two identical sinks give ONE bullet');
    assert.equal(out[0].text, 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelf, upper shelf and panels · square-tube posts with adjustable bullet feet');
    assert.deepEqual(QS.constructionBullets([a], null).map((x) => x.title), ['SS Sink'], 'without a title lookup the line\'s own name leads');
    assert.deepEqual(QS.constructionBullets([custom, { id: 'CUSTOM' }], () => 'x'), []);
    assert.deepEqual(QS.constructionBullets(null), []);
  });
});

describe('the file itself — ES5, DOM-free, price-free, a UMD module', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/qb-spec-sheet.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

  it('ES5 only: no arrow functions, let / const, template literals or classes (it also runs on the public-facing old phones the other UMD helpers target)', () => {
    assert.equal(/=>|\blet\b|\bconst\b|`|\bclass\s+\w+\s*(\{|extends\b)/.test(code), false);
  });

  it('it carries no price: nothing in its code reads or names an amount, a unit price, a price basis or a peso', () => {
    assert.equal(/unitPrice|\bamount\b|priceBasis|basisUnitPrice|basePrice|priceManual|capitalMaterials|₱|\bPHP\b|pricing-core|money-core/.test(code), false);
  });

  it('it touches no DOM, storage, network or clock', () => {
    assert.equal(/\bdocument\b|\bwindow\.(?!QBSpecSheet)|localStorage|sessionStorage|\bfetch\(|XMLHttpRequest|Date\.now|new Date|Math\.random|innerHTML|firebase/i.test(code.replace(/root\.QBSpecSheet|typeof window/g, '')), false);
  });

  it('is a UMD file: require() gives the API, a <script> gives window.QBSpecSheet, and nothing leaks when required', () => {
    const vm = require('node:vm');
    const win = {};
    vm.runInNewContext(src, { window: win });
    assert.equal(typeof win.QBSpecSheet.rows, 'function');
    assert.deepEqual(Object.keys(win.QBSpecSheet).sort(), Object.keys(QS).sort());
    assert.deepEqual(Object.keys(QS).sort(), ['FINISH_LABELS', 'FINISH_ORDER', 'TEXT', 'completeness', 'constructionBullets', 'docNotes', 'fabricatedWithoutSize', 'hasSize', 'html', 'isFabricated', 'leadInfo', 'leadSentence', 'quality', 'rows', 'summaryStrip']);
    const out = vm.runInNewContext('var module={exports:{}}; (function(){' + src + '\n})(); typeof window', {});
    assert.equal(out, 'undefined');
  });
});

describe('KC integration (2026-11-19): a configurator line is never "no finish"', () => {
  it('a line with kcKind satisfies the finish check; the same line without it does not', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const QS2 = req('../js/qb-spec-sheet.js');
    const base = { name: 'Prep table', category: 'fabricated', dims: '1200 x 600 x 850 mm', specs: 'Top 1.5 mm', madeToOrder: true };
    const kc = Object.assign({ kcKind: 'table' }, base);
    assert.equal(QS2.completeness(kc).missing.includes('finish'), false);
    assert.equal(QS2.quality([kc]).weak.some((w) => w.missing.includes('finish')), false);
    assert.equal(QS2.completeness(Object.assign({}, base, { kcKind: '  ' })).missing.includes('finish'), QS2.completeness(base).missing.includes('finish'));
  });
});
