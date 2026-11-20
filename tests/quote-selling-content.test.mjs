// tests/quote-selling-content.test.mjs — WHAT THE QUOTATION SAYS: the words of the selling document (specs/QB-SELLING-QUOTE-SPEC.md Phase 1, owner rulings of
// 2026-11-05 in its §7), pinned where they live, and the words no document may carry.
//
// quote-builder-v2.html and js/config.js are browser files (one inline script, window globals) and cannot be require()d. Like tests/contact-details.test.mjs, each
// literal under test is CUT OUT BY SOURCE and evaluated alone, so a rename or a move throws loudly instead of the test passing on nothing. The warranty and site
// wording are FUNCTIONS of the quote (the company, the warranty plan), so the few helper functions that resolve them are cut out too and run with a stub for the one
// thing they read (the plan select).
//
// WHAT IT PINS
//   1. QB_STANDARD_PAGE   the builder's copy and js/config.js's copy are deep-equal (the builder is an iframe and keeps its own, like CO.*); every value is a string (or a frozen
//                         list / map of strings); the headings are human labels, never ids; the owner's sentences word for word (materials with the HAIRLINE standard finish;
//                         the 12-month service warranty; the KitchenShield PMS sentence; five process steps with NO durations; the references DMMMSU and ISPSC and nothing else;
//                         the registrations as text); no markup, no logo, no agency mark.
//   2. The Warranty and Site Requirements terms   per company and per warranty plan (ruling #1): the default is the 12-month service warranty; the full-kitchen plan adds the
//                         PMS sentence; Barro Industries reads the same; the Site Requirements term names the company that is quoting; the other six terms are exactly as they were.
//                         Brilliant Steel (ruling #6) keeps its old wording byte for byte — the ONE place "12 months warranty" survives in the builder, a pinned constant.
//   3. The approved includes / not-included (§3.5, ruling #3), the hairline default finish (#2) and the lead time (#4) of the eleven families, in scripts/public-families.json,
//                         and what they print for the default configuration and for the None / Without cases (a phrase with an empty placeholder is dropped, never printed empty).
//   4. The banned words      Vesta, Barro Steel, 500+, gmail.com, 0960, La Union, "12 months warranty", ISO / NSF / BTU — in every document string this phase adds (the constants above, the
//                         resolved terms, the family wording, the What's New entry, the spec-sheet text) and, for the three that no file may carry at all, in the whole files.
//
// Mutation-tested in scratch copies (never the shared tree) — each of these must fail here: the builder's QB_STANDARD_PAGE drifting from js/config.js's; the materials sentence back on
// "brushed, mirror or satin finish"; the references naming a third client or carrying a project count; a durations in a process step; the warranty sentence back on 12 months; the
// KitchenShield sentence changed or printed on the standard plan; the Site Requirements term not following the company; a Brilliant Steel term taking the new wording; "Barro Steel" /
// "Vesta" / "gmail.com" in any of the strings; an includes template edited; finishDefault left off a family; the lead time not 25 working days; a placeholder printing empty.
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const BUILDER = read('quote-builder-v2.html');
const CONFIG = read('js/config.js');
const PF = require('../js/product-families.js');
const FAM = require('../js/qr-families.js');
const QS = require('../js/qb-spec-sheet.js');
const FAMILIES_JSON = JSON.parse(read('scripts/public-families.json'));

// ── source extraction (the technique of tests/contact-details.test.mjs) ──────────────────────────────────────────────────────────────
function sliceBetween(src, from, to, label) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, `${label}: "${from}" was not found — if it was renamed or moved, update this test rather than deleting it`);
  const j = src.indexOf(to, i + from.length);
  assert.ok(j >= 0, `${label}: "${to}" was not found after "${from}"`);
  return src.slice(i, j + to.length);
}
// `function name(...) { … }`, braces balanced from the first { after the signature
function fnSource(src, name, label) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${label}: function ${name}() was not found`);
  let depth = 0;
  for (let i = src.indexOf('{', src.indexOf(')', at)); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`${label}: unbalanced ${name}`);
}

const BUILDER_STD_CODE = sliceBetween(BUILDER, 'const QB_STANDARD_PAGE = Object.freeze({', '\n});', 'quote-builder-v2.html');
const LEGACY_CODE = sliceBetween(BUILDER, 'const TERMS_LEGACY = Object.freeze({', '\n});', 'quote-builder-v2.html');
const CO_CODE = sliceBetween(BUILDER, 'const CO = {', '\n};', 'quote-builder-v2.html');
const TERMS_CODE = sliceBetween(BUILDER, 'const TERMS_DEF=[', '\n];', 'quote-builder-v2.html');
const CONFIG_STD_CODE = sliceBetween(CONFIG, 'window.QB_STANDARD_PAGE = Object.freeze({', '\n});', 'js/config.js');

const builderStd = new Function(`${BUILDER_STD_CODE}\nreturn QB_STANDARD_PAGE;`)();
const configStd = new Function('window', `${CONFIG_STD_CODE}\nreturn window.QB_STANDARD_PAGE;`)({});

// the terms of the builder, resolved for one company / warranty plan: the real TERMS_DEF and the real helpers, with the plan select stubbed
const resolver = new Function(`
  ${CO_CODE}
  ${BUILDER_STD_CODE}
  ${LEGACY_CODE}
  let currentCo = 'BK', __plan = 'service6';
  const document = { getElementById: (id) => (id === 'warrantyPlan' ? { value: __plan } : null) };
  const getValidDays = () => 30;
  ${fnSource(BUILDER, 'titleCaseCo', 'quote-builder-v2.html')}
  ${fnSource(BUILDER, 'isLegacyDoc', 'quote-builder-v2.html')}
  ${fnSource(BUILDER, 'getWarrantyPlan', 'quote-builder-v2.html')}
  ${fnSource(BUILDER, 'warrantyTermText', 'quote-builder-v2.html')}
  ${fnSource(BUILDER, 'siteTermText', 'quote-builder-v2.html')}
  ${TERMS_CODE}
  return {
    CO, TERMS_DEF, TERMS_LEGACY, QB_STANDARD_PAGE,
    terms(co, plan) { currentCo = co; __plan = plan; return Object.fromEntries(TERMS_DEF.map((t) => [t.id, typeof t.content === 'function' ? t.content(getValidDays()) : t.content])); },
    isLegacyDoc(plan) { __plan = plan; return isLegacyDoc(); },
  };
`)();

const WARRANTY_6 = '12-month service warranty on our equipment and work. Warranty does not cover misuse, physical damage, or failure to maintain the equipment.';
const KITCHENSHIELD = 'KitchenShield™ preventive maintenance service (PMS) for 12 months is offered with this project at a discounted rate.';
// Brilliant Steel exactly as it was (owner ruling 2026-11-05 #6)
const BS_WARRANTY_OLD = '12 months warranty on fabrication workmanship. Warranty does not cover misuse, physical damage, or failure to maintain equipment properly.';
const BS_SITE_OLD = 'Client is responsible for ensuring site is ready for installation. Barro Kitchens is not liable for delays due to unprepared site conditions.';

// the words no document may carry (R3 / R4 / R5, the ruling's list). `scoped` ones are checked in the strings this phase adds; `anywhere` ones in whole files too.
const BANNED = [
  ['Vesta', /Vesta/i], ['Barro Steel', /Barro Steel/i], ['a project count ("500+")', /500\+/], ['a Gmail address', /gmail\.com/i], ['the old 0960 number', /\b0960/],
  ['the La Union address', /La Union/i], ['"12 months warranty"', /12 months warranty/i], ['an invented certification (ISO / NSF / BTU)', /\bISO\b|\bNSF\b|\bBTU/i],
];
const assertClean = (what, text) => { for (const [name, re] of BANNED) assert.equal(re.test(text), false, `${what} carries ${name}: ${String(text).slice(0, 160)}`); };
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out)); return out; };

describe('QB_STANDARD_PAGE — the text of the "Our standard" page', () => {
  it('the builder\'s copy and js/config.js\'s copy are deep-equal (the iframe cannot read config.js, so the two are kept in step by this test)', () => {
    assert.deepEqual(builderStd, configStd);
    assert.equal(JSON.stringify(builderStd), JSON.stringify(configStd), 'same keys in the same order');
  });

  it('is frozen, all the way down, and holds strings only (a map or a list of strings, never a number, a function or markup)', () => {
    for (const std of [builderStd, configStd]) {
      const walk = (v, where) => {
        if (typeof v === 'string') return;
        assert.ok(v && typeof v === 'object', `${where} is not a string, list or map`);
        assert.equal(Object.isFrozen(v), true, `${where} is not frozen`);
        Object.entries(v).forEach(([k, x]) => walk(x, `${where}.${k}`));
      };
      walk(std, 'QB_STANDARD_PAGE');
    }
    assert.equal(strings(builderStd).some((s) => /[<>]|&lt;|&amp;[a-z]|<img|logo|badge|\.png|\.svg|\.jpe?g/i.test(s)), false, 'a registration or reference is TEXT: no markup, no logo, no agency mark');
  });

  it('the owner\'s words, word for word: materials with HAIRLINE as the standard finish, the 12-month service warranty, the KitchenShield PMS sentence, the references, the registrations', () => {
    assert.equal(builderStd.title, 'Our standard');
    assert.equal(builderStd.materials, 'Our standard material is SS304 food-grade stainless steel. SS316 laboratory grade is available on request. Standard finish: hairline. Brushed, mirror or satin on request.');
    assert.equal(builderStd.warranty.service6, WARRANTY_6);
    assert.equal(builderStd.warranty.kitchenshield12, KITCHENSHIELD);
    assert.deepEqual(Object.keys(builderStd.warranty), ['service6', 'kitchenshield12']);
    assert.equal(builderStd.references, 'Institutional clients include DMMMSU and ISPSC.');
    assert.equal(builderStd.registrations, 'Barro Industries OPC is SEC-registered, VAT-registered and PhilGEPS-registered.');
    assert.deepEqual({ ...builderStd.brand }, { BK: 'Barro Kitchens, by Barro Industries OPC', BI: 'Barro Industries' });
  });

  it('the headings are human labels, never an id; "How we work" is the five steps, NO durations; the references name DMMMSU and ISPSC and nothing else (no project count)', () => {
    assert.deepEqual({ ...builderStd.headings }, { materials: 'Materials & finishes', construction: 'Standard construction', warranty: 'Warranty & after-sales', process: 'How we work', references: 'References', registrations: 'Registrations' });
    for (const h of Object.values(builderStd.headings)) assert.equal(/[_]|^[a-z]+$|PREP_WASHING|COOKING_LINE/.test(h), false, h);
    assert.deepEqual([...builderStd.process], ['Site measurement and design', 'Fabrication in our Quezon City shop', 'Delivery', 'Installation and commissioning', 'Turnover and after-sales service']);
    for (const step of builderStd.process) assert.equal(/\d|\bdays?\b|\bweeks?\b|\bmonths?\b|working/i.test(step), false, `a process step states a duration: ${step}`);
    const clients = builderStd.references.match(/\b[A-Z]{3,}\b/g);
    assert.deepEqual(clients, ['DMMMSU', 'ISPSC'], 'exactly the two clients the owner allows');
    assert.equal(/\d/.test(builderStd.references + builderStd.registrations), false, 'no count, no registration number — none was supplied');
    assert.equal(/ISO|NSF|certif|accredit|award|best|leading|number one|#1/i.test(strings(builderStd).join(' ')), false, 'no invented credential or superlative');
  });

  it('it states the SS304 standard and the hairline finish — and the old "three finishes" / "No.4" wording is gone', () => {
    assert.match(builderStd.materials, /SS304 food-grade/);
    assert.match(builderStd.materials, /Standard finish: hairline\./);
    for (const f of ['Brushed', 'mirror', 'satin']) assert.ok(builderStd.materials.includes(f));
    assert.equal(/No\.?4/.test(builderStd.materials), false);
  });
});

describe('the Warranty and Site Requirements terms — per company and per warranty plan (owner rulings 2026-11-05 #1 and #6)', () => {
  it('Barro Kitchens, standard plan (the default): exactly the 12-month service warranty — no KitchenShield', () => {
    const t = resolver.terms('BK', 'service6');
    assert.equal(t.tc_warranty, WARRANTY_6);
    assert.match(t.tc_warranty, /12-month service warranty/);
    assert.equal(/KitchenShield|12 months|PMS/.test(t.tc_warranty), false);
  });

  it('the full-kitchen plan: the 6-month sentence PLUS the KitchenShield sentence, exactly — and the 12 months are the PMS, never a warranty', () => {
    for (const co of ['BK', 'BI']) {
      const t = resolver.terms(co, 'kitchenshield12');
      assert.equal(t.tc_warranty, `${WARRANTY_6} ${KITCHENSHIELD}`, co);
      assert.ok(t.tc_warranty.endsWith('KitchenShield™ preventive maintenance service (PMS) for 12 months is offered with this project at a discounted rate.'));
      assert.equal(/12 months warranty|12-month warranty/i.test(t.tc_warranty), false);
    }
  });

  it('an unknown or garbled plan reads as the standard plan; Barro Industries reads exactly like Barro Kitchens', () => {
    for (const plan of [undefined, null, 'KITCHENSHIELD12', 'kitchenshield', 'full', 'service12']) assert.equal(resolver.terms('BK', plan).tc_warranty, WARRANTY_6, String(plan));
    assert.equal(resolver.terms('BI', 'service6').tc_warranty, resolver.terms('BK', 'service6').tc_warranty);
  });

  it('Site Requirements names the company that is quoting: Barro Kitchens, Barro Industries OPC', () => {
    assert.equal(resolver.terms('BK', 'service6').tc_site, 'Client is responsible for ensuring site is ready for installation. Barro Kitchens is not liable for delays due to unprepared site conditions.');
    assert.equal(resolver.terms('BI', 'service6').tc_site, 'Client is responsible for ensuring site is ready for installation. Barro Industries OPC is not liable for delays due to unprepared site conditions.');
    assert.equal(resolver.terms('BI', 'kitchenshield12').tc_site, resolver.terms('BI', 'service6').tc_site, 'the plan does not touch it');
  });

  it('Brilliant Steel is LEFT EXACTLY AS IT WAS: its Warranty and Site Requirements terms are the old text byte for byte, whatever the plan — the one place the old sentence survives', () => {
    assert.deepEqual({ ...resolver.TERMS_LEGACY }, { tc_warranty: BS_WARRANTY_OLD, tc_site: BS_SITE_OLD });
    for (const plan of ['service6', 'kitchenshield12']) {
      const t = resolver.terms('BS', plan);
      assert.equal(t.tc_warranty, BS_WARRANTY_OLD);
      assert.equal(t.tc_site, BS_SITE_OLD);
    }
    // …and it survives in exactly ONE place in the whole builder (every Barro Kitchens / Barro Industries string is clean)
    assert.equal((BUILDER.match(/12 months warranty/g) || []).length, 1);
    assert.ok(LEGACY_CODE.includes('12 months warranty on fabrication workmanship'));
    assert.equal(Object.isFrozen(resolver.TERMS_LEGACY), true);
  });

  it('a quotation "as issued" (the plan select holds \'\' — it was filed before the plan existed, then reopened or revised) keeps the OLD warranty and Site Requirements wording, byte for byte, for Barro Kitchens AND Barro Industries', () => {
    for (const co of ['BK', 'BI', 'BS']) {
      const t = resolver.terms(co, '');
      assert.equal(t.tc_warranty, BS_WARRANTY_OLD, co);
      assert.equal(t.tc_site, BS_SITE_OLD, `${co}: the old Site Requirements text names Barro Kitchens whichever company quotes`);
      assert.equal(/KitchenShield|6-month/.test(t.tc_warranty), false, co);
    }
    // the current plans never produce the old wording, and the old wording is one pinned constant (nothing else in the builder carries it)
    for (const co of ['BK', 'BI']) for (const plan of ['service6', 'kitchenshield12']) assert.notEqual(resolver.terms(co, plan).tc_warranty, BS_WARRANTY_OLD, `${co}/${plan}`);
    assert.equal(resolver.isLegacyDoc('') && !resolver.isLegacyDoc('service6') && !resolver.isLegacyDoc('kitchenshield12') && !resolver.isLegacyDoc(undefined) && !resolver.isLegacyDoc(null), true);
  });

  it('the other terms are exactly the text every quotation has always carried (a stored-wording quote and a new one read the same)', () => {
    const t = resolver.terms('BK', 'service6');
    assert.equal(t.tc_completion, 'Work will be completed within the agreed timeline from date of down payment receipt. Delays due to client-side changes or site issues are not included.');
    assert.equal(t.tc_payment, 'Down payment due upon confirmation; balance settled per the Payment Schedule above. All payments are non-refundable once fabrication has commenced.');
    assert.equal(t.tc_scope, 'Price covers fabrication, delivery, and installation as specified. Electrical works, gas connections, and civil works are excluded unless stated.');
    assert.equal(t.tc_tolerance, 'All fabricated dimensions are subject to a measurement tolerance of ±5mm, standard for stainless steel fabrication. Variations within this tolerance are not grounds for rework or rejection.');
    assert.equal(t.tc_validity, 'This quotation is valid for 30 days from date of issuance. Prices are subject to change after validity.');
    assert.equal(t.tc_acceptance, 'By signing this quotation, the client accepts all terms and conditions stated herein.');
    assert.deepEqual(resolver.TERMS_DEF.map((x) => x.id), ['tc_completion', 'tc_payment', 'tc_warranty', 'tc_scope', 'tc_tolerance', 'tc_validity', 'tc_site', 'tc_acceptance']);
  });

  it('every resolved term of a Barro Kitchens / Barro Industries quotation is clean of the banned words', () => {
    for (const co of ['BK', 'BI']) for (const plan of ['service6', 'kitchenshield12']) for (const [id, text] of Object.entries(resolver.terms(co, plan))) assertClean(`${co}/${plan}/${id}`, text);
  });
});

describe('the families\' finish, lead time, includes and not-included — the approved §3.5 table (rulings 2026-11-05 #2, #3, #4)', () => {
  // the table as the owner APPROVED it, one template per family (placeholders fill from the configuration; `i` wordings on the options carry the words)
  const APPROVED = {
    prep_table: { includes: '{layers} · adjustable bullet feet' },
    sink: { includes: '{basins} with waste fittings and strainers · {faucet} · adjustable bullet feet', excludes: 'water supply and drain line to the sink · angle valves' },
    dish_table: { includes: '{side} as configured · {sink} · adjustable bullet feet', excludes: 'dishwasher · plumbing to the point' },
    stove: { includes: 'burners as configured with gas valves · {addons} · adjustable bullet feet', excludes: 'LPG tanks, regulator and hose beyond the appliance connection (see Gas Line)' },
    wok_range: { includes: 'wok rings and high-pressure burners as configured · {faucet}', excludes: 'gas line and LPG supply' },
    cooking_line: { excludes: 'gas line and LPG supply' },
    deck_oven: { includes: 'gas burner, valve and thermometer per deck · {stand}', excludes: 'gas line and LPG supply' },
    hood: { includes: 'canopy with grease trough and oil cup · {filters} · {lighting}', excludes: 'ducting, blower and fresh-air supply (quoted separately) · electrical to the switch' },
    cabinet: { includes: 'doors and shelves as configured' },
    wall_shelf: { includes: 'wall brackets and anchors' },
    rack: { includes: 'shelves as configured · {wheels}' },
  };
  const fam = (id) => FAM.families[id];
  const printed = (id, cfg) => PF.fillTemplate(fam(id), fam(id).includes, Object.assign({}, PF.defaultConfig(fam(id)), cfg || {}));
  const dflt = { grade: 304 };

  it('every one of the eleven families carries finishDefault "hairline" (the standard finish) and leadTime "25 working days" (the minimum) — in the source and in the generated file', () => {
    assert.deepEqual(FAMILIES_JSON.order, Object.keys(APPROVED));
    for (const id of FAMILIES_JSON.order) {
      for (const f of [FAMILIES_JSON.families[id], fam(id)]) {
        assert.equal(f.finishDefault, 'hairline', id);
        assert.equal(f.leadTime, '25 working days', id);
      }
    }
  });

  it('the includes and not-included templates are the approved table, word for word (a family the table leaves blank carries none); the schema version did not move', () => {
    for (const id of FAMILIES_JSON.order) {
      const f = FAMILIES_JSON.families[id];
      assert.equal(f.includes, APPROVED[id].includes, `${id}: includes`);
      assert.equal(f.excludes, APPROVED[id].excludes, `${id}: excludes`);
      assert.equal(fam(id).includes, APPROVED[id].includes);
      assert.equal(fam(id).excludes, APPROVED[id].excludes);
    }
    assert.equal(FAMILIES_JSON.version, 5, 'optional document fields do not change what the pricing sheets price: the schema stays 5');
    assert.match(FAMILIES_JSON._readme, /SELLING QUOTE/);
    assert.equal(FAM.version, 5);
  });

  it('what each family PRINTS for its default configuration', () => {
    assert.equal(printed('prep_table'), 'worktop · adjustable bullet feet');
    assert.equal(printed('sink'), '1 basin with waste fittings and strainers · gooseneck faucet · adjustable bullet feet');
    assert.equal(printed('dish_table'), 'clean side as configured · adjustable bullet feet');
    assert.equal(printed('stove'), 'burners as configured with gas valves · adjustable bullet feet');
    assert.equal(printed('wok_range'), 'wok rings and high-pressure burners as configured · drain trough');
    assert.equal(printed('deck_oven'), 'gas burner, valve and thermometer per deck');
    assert.equal(printed('hood'), 'canopy with grease trough and oil cup · stainless baffle grease filters · lamp and switch');
    assert.equal(printed('cabinet'), 'doors and shelves as configured');
    assert.equal(printed('wall_shelf'), 'wall brackets and anchors');
    assert.equal(printed('rack'), 'shelves as configured · wheels');
    assert.equal(PF.fillTemplate(fam('cooking_line'), fam('cooking_line').includes, PF.defaultConfig(fam('cooking_line'))), '', 'the griddle / griller / fryer family has no includes');
  });

  it('a placeholder whose option is None / Without / absent is DROPPED with its phrase, never printed empty (hood, dish table, wok range, deck oven, stove, rack, prep table, sink)', () => {
    assert.equal(printed('hood', { filters: 'none', lighting: false }), 'canopy with grease trough and oil cup');
    assert.equal(printed('hood', { filters: 'none' }), 'canopy with grease trough and oil cup · lamp and switch');
    assert.equal(printed('hood', { lighting: false }), 'canopy with grease trough and oil cup · stainless baffle grease filters');
    assert.equal(printed('dish_table', { side: 'soiled' }), 'soiled side as configured · adjustable bullet feet', 'no pre-rinse sink chosen: no "pre-rinse unit"');
    assert.equal(printed('dish_table', { side: 'soiled', sink: 'prerinse' }), 'soiled side as configured · pre-rinse unit · adjustable bullet feet');
    assert.equal(printed('dish_table', { side: 'clean', sink: 'prerinse' }), 'clean side as configured · adjustable bullet feet', 'a pre-rinse sink applies to the soiled side only: on the clean side it is the default (none)');
    assert.equal(printed('wok_range', { faucet: 'swan' }), 'wok rings and high-pressure burners as configured · water tap and drain trough');
    assert.equal(printed('wok_range', { faucet: 'none' }), 'wok rings and high-pressure burners as configured · drain trough', 'no faucet chosen: no water tap');
    assert.equal(printed('deck_oven', { stand: 'heavy' }), 'gas burner, valve and thermometer per deck · heavy-duty stand');
    assert.equal(printed('deck_oven', { stand: 'none' }), 'gas burner, valve and thermometer per deck');
    assert.equal(printed('stove', { addons: ['griller', 'fryer'] }), 'burners as configured with gas valves · griller, fryer · adjustable bullet feet', 'in the family\'s own add-on order');
    assert.equal(printed('stove', { addons: [] }), 'burners as configured with gas valves · adjustable bullet feet');
    assert.equal(printed('rack', { wheels: false }), 'shelves as configured · adjustable bullet feet');
    assert.deepEqual([1, 2, 3].map((layers) => printed('prep_table', { layers })), ['worktop · adjustable bullet feet', 'worktop and 1 undershelf · adjustable bullet feet', 'worktop and 2 undershelves · adjustable bullet feet']);
    assert.deepEqual([1, 2, 3, 4].map((basins) => printed('sink', { basins }).split(' · ')[0]), ['1 basin with waste fittings and strainers', '2 basins with waste fittings and strainers', '3 basins with waste fittings and strainers', '4 basins with waste fittings and strainers']);
    assert.equal(printed('sink', { faucet: 'prerinse' }).split(' · ')[1], 'pre-rinse spray faucet');
    for (const id of FAMILIES_JSON.order) assert.equal(/\{|\}|undefined|null|\bNone\b|\bWithout\b|·\s*·|^\s*·|·\s*$/.test(printed(id, dflt)), false, `${id}: an empty or raw placeholder was printed`);
  });

  it('every includes / not-included / lead-time / finish string is clean of the banned words — the owner\'s words and nothing invented (no gauge, no brand, no BTU, no certification)', () => {
    for (const id of FAMILIES_JSON.order) {
      const f = FAMILIES_JSON.families[id];
      assertClean(`${id}/includes`, f.includes || '');
      assertClean(`${id}/excludes`, f.excludes || '');
      assertClean(`${id}/leadTime`, f.leadTime);
      assertClean(`${id}/finishDefault`, f.finishDefault);
      for (const g of f.groups) for (const o of g.options) if (o.i !== undefined) assertClean(`${id}/${g.key}/${o.v}/i`, o.i);
    }
  });
});

describe('the banned words — in every string this phase adds, and in the whole files for the three no file may carry', () => {
  it('QB_STANDARD_PAGE (both copies), CO.BK / CO.BI, the spec-sheet text and the finish labels are clean', () => {
    assertClean('QB_STANDARD_PAGE (builder)', strings(builderStd).join(' | '));
    assertClean('QB_STANDARD_PAGE (config.js)', strings(configStd).join(' | '));
    for (const co of ['BK', 'BI']) assertClean(`CO.${co}`, strings(resolver.CO[co]).join(' | '));
    assertClean('QBSpecSheet.TEXT', strings(QS.TEXT).join(' | '));
    assertClean('QBSpecSheet.FINISH_LABELS', strings(QS.FINISH_LABELS).join(' | '));
  });

  it('the What\'s New entry of this phase is clean (the old warranty sentence is not quoted back, even to say it is gone)', () => {
    const wn = new Function(`${sliceBetween(BUILDER, 'const WHATS_NEW = [', '\n];', 'quote-builder-v2.html')}\nreturn WHATS_NEW;`)();
    // 52 (the approval link, 2026-11-20), 51 (the configurators) and 50 (owner Q70, Back to the form) sit on top; this phase's entries are 49 and 48
    assert.equal(wn[0].ver, 53); assertClean('What\'s New 53', wn[0].items.join(' | ')); wn.shift();   // 53: owner 2026-11-20, the 12-month warranty
    assert.deepEqual(wn.slice(0, 5).map((e) => e.ver), [52, 51, 50, 49, 48]);
    assertClean('What\'s New 52', wn[0].items.join(' | '));
    assertClean('What\'s New 51', wn[1].items.join(' | '));
    assertClean('What\'s New 50', wn[2].items.join(' | '));
    assertClean('What\'s New 49', wn[3].items.join(' | '));
    assertClean('What\'s New 48', wn[4].items.join(' | '));
  });

  it('Vesta, a project count ("500+") and the old 0960 number appear in NO line of the builder, js/config.js, js/screens/sales.js, q/index.html or the new helper', () => {
    for (const f of ['quote-builder-v2.html', 'js/config.js', 'js/screens/sales.js', 'q/index.html', 'js/qb-spec-sheet.js', 'js/qb-configured.js', 'scripts/public-families.json']) {
      const src = read(f);
      for (const [name, re] of [['Vesta', /Vesta/i], ['a project count ("500+")', /500\+/], ['the old 0960 number', /\b0960/]]) assert.equal(re.test(src), false, `${f} carries ${name}`);
    }
  });

  it('the registrations and the references are TEXT in the builder too: nothing in it draws a PhilGEPS / SEC / VAT mark, and no client other than DMMMSU and ISPSC is named in a document string', () => {
    const doc = strings(builderStd).join(' | ') + ' | ' + strings(resolver.terms('BK', 'kitchenshield12')).join(' | ');
    assert.equal(/<img|logo|\.png|\.svg/i.test(doc), false);
    for (const name of ['ISPSC', 'DMMMSU']) assert.ok(doc.includes(name));
    assert.equal(/\bUniversity\b|\bState College\b|\bDepartment of\b/.test(doc), false, 'a client is named by its acronym, as the owner allows');
  });

  it('the Standard page is drawn from text alone: nothing in renderStandardPage() emits an image, an icon, a logo or an agency mark (a mark is not ours to print: the registrations are words)', () => {
    const code = fnSource(BUILDER, 'renderStandardPage', 'quote-builder-v2.html').replace(/\/\/.*$/gm, '');
    assert.equal(/<img|<svg|<picture|<canvas|<object|<embed|<iframe|url\(|\.png|\.jpe?g|\.svg|\.webp|logo|philgeps\.|background/i.test(code), false);
  });
});
