// tests/catalogue-public.test.mjs — PUBLIC-WEBSITE-SPEC.md §7.3, plus the two owner rulings that
// govern the public site: R1 NO PRICES anywhere, and R5 the partner company is NEVER named.
//
// Pins scripts/build-catalogue.js — the field ALLOWLIST that keeps every price field out of the
// baked catalogue, the money guard, the partner-brand guard — and the committed index.html /
// public-surface files those guards protect — and, last, the inline <head> script that picks the
// first-paint view (site / login / boot), run in a vm against the spec §4.2 decision table.
// Fixtures are synthetic: the private master (products-database.json) is gitignored and absent
// in CI, so nothing here reads it.
//
// Mutation-tested (scratch copy, never the shared tree): making publicProduct() spread `...p`
// must fail "allowlist" below; removing the brand guard must fail "partner-brand guard".
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const B = require('../scripts/build-catalogue.js');
const { publicProduct, renderCatalogue, injectIntoHtml, stripJsonComments, NOTE_OVERRIDES,
        MONEY_RE, FORMULA_RE, BRAND_RE, START_MARKER, END_MARKER, CatalogueGuardError } = B;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── synthetic fixtures ──────────────────────────────────────────────────────
const CATS = [
  { id: 'cooking_line', label: 'Cooking Line', code: 'CE', color: '#E74C3C', icon: 'x' },
  { id: 'prep_washing', label: 'Preparation & Washing', code: 'PW', color: '#3498DB', icon: 'y' },
];
// 1 — per_length with a formula, labour, lead time, an unlisted material key and a secret extra field.
const PER_LENGTH = {
  id: 'T-001', category: 'cooking_line', name: 'Test Stove <b>One</b>', shortName: 'Stove 1',
  formulaType: 'per_length', basePrice: 18000,
  defaultDimensions: { W: 1200, D: 700, H: 850 },
  formula: { baseLengthMm: 600, pricePerExtraMm: 8, rateW100: 800, rateD100: 600, rateH100: 0 },
  specs: [], laborHours: { fabrication: 8, installation: 2, teamSize: 2 }, leadTime: '10-14 days',
  notes: 'LP burner, SS304 1.1mm top', unit: 'pc',
  material: { grade: 'SS304', finish: 'No.4 brushed', topGauge: 1.2, priceNote: 'hidden' },
  secretCostBreakdown: { margin: 0.4 },
};
// 2 — specs[].priceAdder (and a default) on a product with a partial size.
const WITH_ADDER = {
  id: 'T-002', category: 'prep_washing', name: 'Test Sink', formulaType: 'configurable', basePrice: 9000,
  defaultDimensions: { W: 800, D: null, H: 900 }, formula: {}, laborHours: {}, leadTime: '7 days', unit: 'pc',
  specs: [{ label: 'Basin Depth', options: ['250mm', '300mm'], default: '250mm', priceAdder: [0, 1500] }],
  notes: 'SS304, 1 basin',
};
// 3 — a note carrying a peso amount.
const PESO_NOTE = { id: 'T-003', category: 'cooking_line', name: 'Test Griddle', basePrice: 5000, unit: 'pc', specs: [], notes: '₱1,500 install' };

const PARTNER = 'Brilliant' + ' Steel';            // built at run time only so this file never needs the literal
const prod = (over) => ({ id: 'T-100', category: 'cooking_line', name: 'Plain Table', unit: 'pc', specs: [], notes: 'SS304', ...over });
const db = (products, categories) => ({ categories: categories || CATS, products });
const render = (products, opts) => renderCatalogue(db(products), { hasPhoto: () => false, ...(opts || {}) });
const violationsOf = (fn) => { try { fn(); } catch (e) { return e.violations || null; } return null; };
const allKeys = (v, out = new Set()) => {
  if (Array.isArray(v)) v.forEach(x => allKeys(x, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) { out.add(k); allKeys(v[k], out); }
  return out;
};
// text between two markers / the lines of a region of index.html
const between = (html, a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i + 1); return html.slice(i + a.length, j); };

describe('publicProduct — the allowlist (R1: no price field can reach the page)', () => {
  const FORBIDDEN = ['basePrice', 'formula', 'formulaType', 'laborHours', 'leadTime', 'priceAdder'];

  it('emits only allowlisted top-level fields', () => {
    for (const fx of [PER_LENGTH, WITH_ADDER]) {
      const out = publicProduct(fx);
      for (const k of Object.keys(out)) {
        assert.ok(['id', 'name', 'category', 'unit', 'defaultDimensions', 'material', 'notes', 'specs'].includes(k), `unexpected field "${k}"`);
      }
    }
  });

  it('contains none of basePrice / formula / formulaType / laborHours / leadTime / priceAdder — as keys or as text', () => {
    for (const fx of [PER_LENGTH, WITH_ADDER]) {
      const out = publicProduct(fx);
      const keys = allKeys(out);
      const json = JSON.stringify(out);
      for (const f of FORBIDDEN) {
        assert.ok(!keys.has(f), `key ${f} leaked`);
        assert.ok(!json.includes(f), `text ${f} leaked`);
      }
      for (const extra of ['shortName', 'secretCostBreakdown', 'default']) assert.ok(!keys.has(extra), `key ${extra} leaked`);
    }
  });

  it('JSON.stringify(output) does not match the money regex or the CHECK 9 token list', () => {
    for (const fx of [PER_LENGTH, WITH_ADDER]) {
      const json = JSON.stringify(publicProduct(fx));
      assert.ok(!MONEY_RE.test(json), 'MONEY_RE matched');
      assert.ok(!FORMULA_RE.test(json), 'FORMULA_RE matched');
    }
  });

  it('keeps specs[].label and specs[].options only, and only finite positive dimensions', () => {
    const out = publicProduct(WITH_ADDER);
    assert.deepEqual(out.specs, [{ label: 'Basin Depth', options: ['250mm', '300mm'] }]);
    assert.deepEqual(out.defaultDimensions, { W: 800, H: 900 });          // D:null dropped
  });

  it('keeps allowlisted material keys with string values only', () => {
    const out = publicProduct(PER_LENGTH);
    assert.deepEqual(out.material, { grade: 'SS304', finish: 'No.4 brushed' });   // numeric topGauge + priceNote dropped
  });

  it('builds field by field: an unknown extra field is never carried over, and the input is not mutated', () => {
    const before = JSON.parse(JSON.stringify(PER_LENGTH));
    const out = publicProduct(PER_LENGTH);
    assert.ok(!('secretCostBreakdown' in out));
    assert.deepEqual(PER_LENGTH, before);
  });

  it('renders dimensions without a thousands separator (it would trip the money scan)', () => {
    const html = render([PER_LENGTH]);
    assert.ok(html.includes('1200 × 700 × 850 mm · per pc'));
    assert.ok(!/\b\d{1,3},\d{3}\b/.test(html));
  });
});

describe('money guard (R1)', () => {
  it('the ₱ fixture throws, naming product + field + rule but never the text', () => {
    assert.throws(() => publicProduct(PESO_NOTE), CatalogueGuardError);
    const v = violationsOf(() => publicProduct(PESO_NOTE));
    assert.deepEqual(v, [{ id: 'T-003', field: 'notes', rule: 'money' }]);
    try { publicProduct(PESO_NOTE); } catch (e) { assert.ok(!/1,500|₱/.test(e.message), 'the amount leaked into the message'); }
    assert.throws(() => render([PESO_NOTE]), CatalogueGuardError);
  });

  it('refuses every money shape in any emitted field', () => {
    const bad = ['₱500', 'PHP 2500', 'PHP2500', 'about 12,000 each', 'price on request', 'cost varies', 'markup 30%',
                 'add rateD100 per 100mm', 'see basePrice', 'laborHours 8', 'ratePerDay'];
    for (const t of bad) {
      for (const field of ['name', 'notes']) {
        assert.throws(() => publicProduct(prod({ id: 'T-200', [field]: t })), CatalogueGuardError, `${field}: ${t}`);
      }
      assert.throws(() => publicProduct(prod({ specs: [{ label: 'Size', options: [t] }] })), CatalogueGuardError, `option: ${t}`);
      assert.throws(() => publicProduct(prod({ specs: [{ label: t, options: ['A'] }] })), CatalogueGuardError, `label: ${t}`);
      assert.throws(() => publicProduct(prod({ material: { grade: t } })), CatalogueGuardError, `material: ${t}`);
    }
  });

  it('FORMULA_RE is exactly the token list ci-invariants.sh CHECK 9 greps for', () => {
    const sh = read('scripts/ci-invariants.sh');
    const m = sh.match(/^CAT_TOKENS='(.*)'$/m);
    assert.ok(m, 'CAT_TOKENS not found in scripts/ci-invariants.sh');
    assert.equal(FORMULA_RE.source, m[1]);
  });

  it('NOTE_OVERRIDES: applied only to a note that trips a money guard, and reported', () => {
    const tripping = prod({ id: 'T-300', notes: 'SS304, price per sqm' });
    const applied = [];
    const out = publicProduct(tripping, { noteOverrides: { 'T-300': 'SS304' }, applied });
    assert.equal(out.notes, 'SS304');
    assert.deepEqual(applied, [{ id: 'T-300', replacement: 'SS304' }]);
    // a clean note is never replaced
    const clean = publicProduct(prod({ id: 'T-300', notes: 'SS304 table' }), { noteOverrides: { 'T-300': 'SS304' }, applied: [] });
    assert.equal(clean.notes, 'SS304 table');
    // no override for the id -> still refused
    assert.throws(() => publicProduct(tripping, { noteOverrides: {} }), CatalogueGuardError);
    // an override that is itself a price is refused
    assert.throws(() => publicProduct(tripping, { noteOverrides: { 'T-300': '₱10' } }), CatalogueGuardError);
  });

  it('renderCatalogue reports every override applied, and the unused ones', () => {
    const report = {};
    render([prod({ id: 'T-300', notes: 'price per sqm' }), prod({ id: 'T-301' })],
      { noteOverrides: { 'T-300': 'Scope varies per project', 'T-999': 'unused' }, report });
    assert.deepEqual(report.overrides, [{ id: 'T-300', replacement: 'Scope varies per project' }]);
    assert.deepEqual(report.unusedOverrides, ['T-999']);
  });

  it('every shipped NOTE_OVERRIDES replacement passes both money guards and the brand guard', () => {
    for (const [id, text] of Object.entries(NOTE_OVERRIDES)) {
      assert.ok(!MONEY_RE.test(text) && !FORMULA_RE.test(text) && !BRAND_RE.test(text), `${id} replacement trips a guard`);
    }
    assert.equal(NOTE_OVERRIDES['EX-015'], 'Scope varies per project');     // spec §7.2
  });
});

describe('partner-brand guard (R5: the partner company is never named on the public site)', () => {
  it('BRAND_RE catches case, spacing and a missing space', () => {
    for (const t of [PARTNER, PARTNER.toUpperCase(), 'brilliant   steel', 'BrilliantSteel', 'Brilliant\nSteel']) assert.ok(BRAND_RE.test(t), t);
    assert.ok(!BRAND_RE.test('Brilliant ideas in steel'));
  });

  it('refuses the name in every emitted field', () => {
    const cases = {
      name: { name: `${PARTNER} Range Hood` },
      notes: { notes: `Made with ${PARTNER}` },
      'specs[0].label': { specs: [{ label: PARTNER, options: ['A'] }] },
      'specs[0].options[0]': { specs: [{ label: 'Brand', options: [PARTNER] }] },
      'material.grade': { material: { grade: PARTNER } },
      unit: { unit: PARTNER },
    };
    for (const [field, over] of Object.entries(cases)) {
      const v = violationsOf(() => publicProduct(prod({ id: 'T-400', ...over })));
      assert.ok(v && v.some(x => x.id === 'T-400' && x.field === field && x.rule === 'brand'), `not refused in ${field}`);
    }
  });

  it('also refuses it in fields the allowlist would DROP (a partner-branded record is never shipped under a clean name)', () => {
    for (const over of [{ shortName: `${PARTNER} 1` }, { leadTime: PARTNER }, { formula: { note: PARTNER } }, { [`${PARTNER.replace(' ', '')}Only`]: true }]) {
      const v = violationsOf(() => publicProduct(prod({ id: 'T-401', ...over })));
      assert.ok(v && v.some(x => x.rule === 'brand'), JSON.stringify(Object.keys(over)));
    }
  });

  it('never echoes the matched text, and an override cannot launder a brand mention', () => {
    const rec = prod({ id: 'T-402', notes: `${PARTNER} unit, price per set` });
    const applied = [];
    try { publicProduct(rec, { noteOverrides: { 'T-402': 'SS304' }, applied }); assert.fail('should have thrown'); }
    catch (e) {
      assert.ok(e instanceof CatalogueGuardError);
      assert.ok(e.violations.some(x => x.rule === 'brand'), 'brand violation missing');
      assert.ok(!BRAND_RE.test(e.message), 'message echoes the partner name');
      assert.ok(e.message.includes('T-402'));
    }
    assert.deepEqual(applied, [], 'an override was applied to a partner-branded note');
  });

  it('refuses an override whose replacement text names the partner', () => {
    const v = violationsOf(() => publicProduct(prod({ id: 'T-403', notes: 'price per set' }), { noteOverrides: { 'T-403': `Made with ${PARTNER}` } }));
    assert.deepEqual(v, [{ id: 'T-403', field: 'notes', rule: 'brand' }]);
  });

  it('refuses a partner-branded category label and the whole build — it is never dropped or renamed silently', () => {
    const cats = [{ ...CATS[0], label: `${PARTNER} Line` }, CATS[1]];
    assert.throws(() => renderCatalogue(db([prod({})], cats), { hasPhoto: () => false }), CatalogueGuardError);
    const v = violationsOf(() => render([prod({ id: 'T-500' }), prod({ id: 'T-501', name: `${PARTNER} Table` }), prod({ id: 'T-502', notes: PARTNER })]));
    assert.deepEqual(v.map(x => x.id).sort(), ['T-501', 'T-502']);      // every offender listed; the clean one is not
  });
});

describe('renderCatalogue', () => {
  const PRODUCTS = [WITH_ADDER, PER_LENGTH];                                // deliberately out of category order
  const html = render(PRODUCTS);

  it('has no <script and escapes markup in a product name', () => {
    assert.ok(!/<script/i.test(html));
    assert.ok(html.includes('Test Stove &lt;b&gt;One&lt;/b&gt;'));
    assert.ok(!html.includes('<b>One'));
    assert.ok(html.includes('data-name="test stove &lt;b&gt;one&lt;/b&gt;"'));
  });

  it('puts each product in exactly one category group (one card, one data-cat group per product)', () => {
    assert.equal((html.match(/<li class="cat-card"/g) || []).length, PRODUCTS.length);
    const groups = html.split('<section class="cat-group"').slice(1);
    assert.equal(groups.length, 2);
    for (const p of PRODUCTS) {
      const holders = groups.filter(g => g.includes(`>${p.id}</div>`));
      assert.equal(holders.length, 1, `${p.id} appears in ${holders.length} groups`);
      assert.ok(holders[0].startsWith(` data-cat="${p.category}"`), `${p.id} sits in the wrong group`);
    }
  });

  it('orders by category order, then id, and is deterministic', () => {
    assert.ok(html.indexOf('>T-001</div>') < html.indexOf('>T-002</div>'));
    assert.equal(html, render(PRODUCTS));
  });

  it('carries the chip bar, search box and totals', () => {
    assert.ok(html.includes('data-cat="all" aria-pressed="true">All <span>2</span>'));
    assert.ok(html.includes('placeholder="Search 2 products…"'));
    assert.ok(html.includes('id="cat-empty"') && html.includes('hidden>'));
    assert.ok(html.includes('role="group"'));
  });

  it('shows "Show all N" only for a group of more than 8', () => {
    const many = (n) => Array.from({ length: n }, (_, i) => prod({ id: `T-${600 + i}` }));
    assert.ok(render(many(9)).includes('Show all 9</button>'));
    assert.ok(!render(many(8)).includes('cat-more'));
  });

  it('renders partial dimensions labelled, and specs/material as a description list', () => {
    assert.ok(html.includes('W 800 × H 900 mm · per pc'));
    assert.ok(html.includes('<dt>Basin Depth</dt><dd>250mm / 300mm</dd>'));
    assert.ok(html.includes('<dt>Grade</dt><dd>SS304</dd>'));
  });

  it('swaps the tile for a photo only when one exists (spec §7.5)', () => {
    const withPhoto = render(PRODUCTS, { hasPhoto: (id) => id === 'T-001' });
    assert.ok(withPhoto.includes('<img src="site/img/products/T-001.webp"'));
    assert.ok(!withPhoto.includes('>T-001</div>') && withPhoto.includes('>T-002</div>'));
  });

  it('scans category labels too: a price word or the partner name there refuses the build, naming the category', () => {
    const rule = { 'Price List': 'money', 'Cost Centre': 'money', 'Markup Items': 'money', [`${PARTNER} Line`]: 'brand' };
    for (const [label, expected] of Object.entries(rule)) {
      const v = violationsOf(() => renderCatalogue(db([prod({})], [{ ...CATS[0], label }, CATS[1]]), { hasPhoto: () => false }));
      assert.deepEqual(v, [{ id: 'cooking_line', field: 'category.label', rule: expected }], label);
    }
  });

  it('sorts products inside a category by id', () => {
    const out = render([prod({ id: 'T-020', name: 'Second' }), prod({ id: 'T-010', name: 'First' }), prod({ id: 'T-015', name: 'Middle' })]);
    assert.ok(out.indexOf('>T-010</div>') < out.indexOf('>T-015</div>') && out.indexOf('>T-015</div>') < out.indexOf('>T-020</div>'));
  });

  it('rejects a malformed record instead of emitting it', () => {
    assert.throws(() => render([prod({ id: 'bad id' })]), CatalogueGuardError);
    assert.throws(() => render([prod({ category: 'nope' })]), CatalogueGuardError);
    assert.throws(() => render([prod({ id: 'T-1' }), prod({ id: 'T-1' })]), CatalogueGuardError);
    assert.throws(() => renderCatalogue(db([prod({})], [{ ...CATS[0], color: 'red' }]), { hasPhoto: () => false }), CatalogueGuardError);
  });
});

describe('injectIntoHtml / stripJsonComments', () => {
  const page = `<a>before</a>\n${START_MARKER}\nOLD\n${END_MARKER}\n<z>after</z>\n`;

  it('replaces only what sits between the markers, and is idempotent', () => {
    const once = injectIntoHtml(page, '<p>NEW</p>');
    assert.equal(once, `<a>before</a>\n${START_MARKER}\n<p>NEW</p>\n${END_MARKER}\n<z>after</z>\n`);
    assert.equal(injectIntoHtml(once, '<p>NEW</p>'), once);
  });

  it('fails when a marker is missing, duplicated or out of order', () => {
    assert.throws(() => injectIntoHtml('<p>x</p>', 'b'));
    assert.throws(() => injectIntoHtml(page + START_MARKER, 'b'));
    assert.throws(() => injectIntoHtml(`${END_MARKER}\n${START_MARKER}`, 'b'));
    assert.throws(() => injectIntoHtml(page, START_MARKER));
  });

  it('strips // and /* */ comments but never touches string contents', () => {
    const src = '{ // line\n "u": "http://x/*y*/", /* block\n over lines */ "q": "a \\" // b" }';
    assert.deepEqual(JSON.parse(stripJsonComments(src)), { u: 'http://x/*y*/', q: 'a " // b' });
    assert.throws(() => stripJsonComments('{ /* open'));
  });
});

describe('the committed site: index.html + public-site files', () => {
  const html = read('index.html');
  const block = between(html, START_MARKER, END_MARKER);
  const siteStart = html.indexOf('<div id="site"');
  const siteEnd = html.indexOf('<!-- /#site -->');
  const site = html.slice(siteStart, siteEnd);
  const head = html.slice(0, html.indexOf('</head>'));

  it('has both catalogue markers exactly once and a non-empty block', () => {
    assert.equal(html.split(START_MARKER).length - 1, 1);
    assert.equal(html.split(END_MARKER).length - 1, 1);
    assert.ok(block.trim().length > 1000);
    assert.ok(siteStart > 0 && siteEnd > siteStart, 'the #site section is not delimited');
  });

  it('the baked block carries no price token, no formula token and no script (R1)', () => {
    assert.ok(!FORMULA_RE.test(block), 'CHECK 9 token list matched');
    assert.ok(!MONEY_RE.test(block), 'money regex matched');
    assert.ok(!/<script/i.test(block));
  });

  it('the hand-written counts (hero tile, catalogue intro) match the generated block', () => {
    const total = Number(block.match(/data-cat="all" aria-pressed="true">All <span>(\d+)<\/span>/)[1]);
    const cats = (block.match(/<section class="cat-group"/g) || []).length;
    assert.ok(site.includes(`${cats} categories · ${total} products`), 'hero fact tile is stale');
    assert.ok(site.includes(`${total} products in ${cats} categories`), 'catalogue intro is stale');
    assert.equal((block.match(/<li class="cat-card"/g) || []).length, total);
  });

  it('the whole #site section has no peso sign, PHP amount or thousands-separated number (R1)', () => {
    assert.ok(!/₱|PHP ?\d|\b\d{1,3}(,\d{3})+\b/i.test(site));
  });

  it('never names the partner company: <head>, #site section, robots.txt, sitemap.xml, site.css, site.js (R5)', () => {
    assert.ok(!BRAND_RE.test(head.replace(/\s+/g, ' ')), '<head> names the partner');
    assert.ok(!BRAND_RE.test(site.replace(/\s+/g, ' ')), '#site names the partner');
    for (const f of ['robots.txt', 'sitemap.xml', 'css/site.css', 'js/site.js']) assert.ok(!BRAND_RE.test(read(f).replace(/\s+/g, ' ')), `${f} names the partner`);
  });

  it('JSON-LD parses, carries the verified address, and claims nothing unverified', () => {
    const ld = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(ld['@type'], 'LocalBusiness');
    assert.deepEqual(ld.address, { '@type': 'PostalAddress', streetAddress: '21 Capricorn St., Tandang Sora', addressLocality: 'Quezon City', postalCode: '1116', addressRegion: 'Metro Manila', addressCountry: 'PH' });
    for (const k of ['priceRange', 'aggregateRating', 'openingHours', 'geo']) assert.ok(!(k in ld), `${k} must not be claimed`);
    assert.deepEqual(ld.sameAs, ['https://www.facebook.com/barrokitchens']);
  });

  it('the static <title> is byte-identical to SITE_TITLE in js/app.js', () => {
    const title = html.match(/<title>([^<]*)<\/title>/)[1];
    const appTitle = read('js/app.js').match(/const SITE_TITLE = '([^']*)';/)[1];
    assert.equal(title, appTitle);
  });

  it('keeps the version-banner pattern out of the site (the pre-commit hook rewrites it by grep)', () => {
    assert.equal(html.split(' · Barro Industries').length - 1, 1);
    assert.ok(!/v\d+\.\d+\.\d+ · Barro Industries/.test(site));
  });

  it('has no inline handlers in #site, and loads site.js first, ahead of the Firebase SDK', () => {
    assert.ok(!/\son[a-z]+=/i.test(site));
    const firstScript = html.indexOf('<script defer src=');
    assert.ok(html.slice(firstScript).startsWith('<script defer src="js/site.js">'));
  });

  it('precaches site.css and site.js, and never a project photo (spec §8.4)', () => {
    const sw = read('sw.js');
    assert.ok(sw.includes("'/css/site.css',") && sw.includes("'/js/site.js',"));
    assert.ok(!sw.includes("'/site/img/"));
  });

  it('robots.txt and sitemap.xml: the spec shape, and exactly one sitemap URL', () => {
    const robots = read('robots.txt');
    for (const p of ['/q/', '/t/', '/v/', '/track.html', '/sales/', '/projects/', '/partners/', '/parterns/', '/ventures/', '/docs/', '/specs/', '/quote-builder-v2.html', '/quote-builder.html']) {
      assert.ok(robots.includes(`Disallow: ${p}\n`), `robots.txt must disallow ${p}`);
    }
    assert.ok(robots.includes('Sitemap: https://barroindustries.com/sitemap.xml'));
    const sm = read('sitemap.xml');
    assert.deepEqual(sm.match(/<loc>[^<]+<\/loc>/g), ['<loc>https://barroindustries.com/</loc>']);
    assert.match(sm, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });

  it('the 13 project photos exist (26 files), and every reference in #projects resolves', () => {
    const files = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))); })(path.join(ROOT, 'site/img/projects'));
    assert.equal(files.length, 26);
    const refs = [...site.matchAll(/(?:href|src)="(site\/img\/projects\/[^"]+)"/g)].map(m => m[1]);
    assert.equal(refs.length, 26);
    for (const r of refs) assert.ok(fs.existsSync(path.join(ROOT, r)), `missing ${r}`);
  });
});

describe('index.html head script — the first-paint view decision (spec §4.2)', () => {
  // The inline script that sets <html data-view>, run in a vm with a tiny DOM/Storage stub.
  const code = read('index.html').match(/<script>\(function\(\)\{\s*var de = document\.documentElement[\s\S]*?\}\)\(\);<\/script>/)[0]
    .replace(/^<script>/, '').replace(/<\/script>$/, '');
  function decide(env) {
    const attrs = {};
    const de = { setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs };
    const mm = (q) => { if (env.mmThrows) throw new Error('matchMedia'); return { matches: (env.modes || []).some(m => q === `(display-mode: ${m})`) }; };
    const sandbox = {
      document: { documentElement: de }, location: { hash: env.hash || '' }, navigator: { standalone: env.navStandalone },
      localStorage: env.lsThrows ? { getItem() { throw new Error('denied'); } } : { getItem: (k) => (k === 'bi-auth-hint' && env.hint ? '1' : null) },
      window: {},
    };
    if (!env.noMatchMedia) { sandbox.matchMedia = mm; sandbox.window.matchMedia = mm; }
    vm.runInNewContext(code, sandbox);
    return { view: attrs['data-view'], standalone: 'data-standalone' in attrs, wantLogin: sandbox.window._wantLogin === true };
  }
  const CASES = [
    ['a signed-out browser visitor sees the site', {}, 'site', false, false],
    ['a site anchor (#catalogue) is still the site', { hash: '#catalogue' }, 'site', false, false],
    ['a signed-in hint boots into the splash, never the site', { hint: true }, 'boot', false, false],
    ['an app deep link boots, and a signed-out staffer is sent to login', { hash: '#/tasks' }, 'boot', false, true],
    ['an app deep link with a hint', { hash: '#/tasks', hint: true }, 'boot', false, true],
    ['#login cold load shows the login screen', { hash: '#login' }, 'login', false, true],
    ['#login with a hint boots (auth decides) but still asks for login', { hash: '#login', hint: true }, 'boot', false, true],
    ['installed PWA: display-mode standalone', { modes: ['standalone'] }, 'boot', true, false],
    ['installed PWA: display-mode fullscreen', { modes: ['fullscreen'] }, 'boot', true, false],
    ['installed PWA: display-mode minimal-ui', { modes: ['minimal-ui'] }, 'boot', true, false],
    ['installed PWA: display-mode window-controls-overlay', { modes: ['window-controls-overlay'] }, 'boot', true, false],
    ['iOS home-screen app (navigator.standalone)', { navStandalone: true }, 'boot', true, false],
    ['the installed PWA never shows the site, even for #login', { modes: ['standalone'], hash: '#login' }, 'boot', true, true],
    ['localStorage throws -> boot (the app\'s original behaviour)', { lsThrows: true }, 'boot', false, false],
    ['localStorage throws inside a PWA still marks it standalone', { lsThrows: true, modes: ['standalone'] }, 'boot', true, false],
    ['matchMedia throws -> boot', { mmThrows: true }, 'boot', false, false],
    ['matchMedia missing -> boot', { noMatchMedia: true }, 'boot', false, false],
  ];
  for (const [name, env, view, standalone, wantLogin] of CASES) {
    it(name, () => assert.deepEqual(decide(env), { view, standalone, wantLogin }));
  }
});

