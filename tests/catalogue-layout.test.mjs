// tests/catalogue-layout.test.mjs — the 2026-10-21 owner rulings on how /catalogue/ LOOKS and what every card SAYS (eleven configurable cards since 2026-10-28):
//
//   1. FEATURED CARDS. A configurable product is the wide featured card (photo left, tag / serif name / description / labelled Specifications /
//      "Configure & add" right); on a phone it is the normal stacked full-width card; where a category holds several (Storage) they sit side by
//      side as a row of cards, and narrower than that the wide cards take over.
//   2. NO DEAD SPACE. A fixed item is a compact "spec row" (well | code, name, size | Notes | button) from 720px and a compact card on a phone:
//      no giant placeholder letter (a small category line-icon, or no well at all on a phone), one column instead of the old three, rows as
//      tall as their own content, and "Add to quote" directly under / beside the notes.
//   3. NOTES ARE VERY IMPORTANT. Every card shows its note WHOLE (nothing clamps, truncates, hides or shrinks it), at 14px or more, in a near-black
//      that passes 7:1 on both grounds, under a "Notes" label (the material rows under "Specifications"); a card with no note shows no label
//      and no placeholder. The configurable cards add a Material row — the owner's own homepage wording, pinned to the proof bar.
//   4. TIGHTER SPACING between sections and inside cards (upper bounds, so it cannot quietly creep back).
//   5. SEARCH still finds every card — the featured ones included — by running the REAL js/catalogue.js against the REAL generated page in a
//      small fake DOM.
//   6. STANDARD CONSTRUCTION (owner ruling 2026-10-28): a configurable card lists its PUBLIC options, then Size, then a Construction row (how the
//      made-to-order piece is built, at the family defaults), then Material last — and never the staff-only top plate or the word "staff".
//   7. CONDITIONAL OPTIONS (CONFIGURATOR-FAMILIES-2-SPEC §4.1, 2026-10-28): a row for an option that applies only for some values of an earlier choice ends
//      with its condition — "Fry baskets: 1 / 2 / 3 (Type is Fryer)" — and a gated group is still ONE row.
//
// Mutation-tested (scratch copies, never the shared tree): a line-clamp on the notes, the notes at 13px, a paler notes colour, a card with a
// fixed height, the "Notes" label dropped from the generator, the Material row changed, .cat-lead removed from the search haystack, the multi
// grid class dropped, the old 3-column grid restored, a letter tile restored — each must fail here. 2026-10-28: the card listing the staff-only
// group, the Construction row dropped or moved below Material — each must fail here too. 2026-10-28 (cf2-ws1-mut/): the card row losing its condition suffix, Ventilation
// after Storage, the hood card without its "Learn more" link — each must fail here too.
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
const FAMS = require('../js/qr-families.js');
const PF = require('../js/product-families.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const page = read('catalogue/index.html');
const block = page.slice(page.indexOf(B.START_MARKER) + B.START_MARKER.length, page.indexOf(B.END_MARKER));
const home = read('index.html');
const css = read('css/catalogue.css');
const qrCss = read('css/quote-request.css');
const catJs = read('js/catalogue.js');

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const stripTags = (html) => decode(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// ── a small CSS reader: [{ media, selector, decls }] — enough to pin real declarations instead of strings ─────────────────────────────────
function parseCss(text, media = null, out = []) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    let depth = 0, j = open;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) break; } }
    const body = src.slice(open + 1, j);
    if (prelude.startsWith('@media')) parseCss(body, prelude.replace(/^@media\s*/, '').replace(/\s+/g, ' '), out);
    else if (!prelude.startsWith('@')) {
      const decls = {};
      for (const d of body.split(';')) { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
      for (const sel of prelude.split(/,(?![^(]*\))/)) out.push({ media: media || null, selector: sel.trim().replace(/\s+/g, ' '), decls });
    }
    i = j + 1;
  }
  return out;
}
const RULES = parseCss(css);
const MIN720 = '(min-width:720px)';
const MULTI = '(min-width:820px) and (max-width:1023px),(min-width:1100px)';
// every declaration that applies to a selector inside one media context, later rules winning (the cascade for one context)
const merged = (selector, media = null) => Object.assign({}, ...RULES.filter((r) => r.selector === selector && r.media === media).map((r) => r.decls));
const px = (v) => parseFloat(String(v).replace('px', ''));
const lum = (hex) => { const c = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// ── synthetic products for the generator ──────────────────────────────────────────────────────────────────────────────────────────────────
const CATS = [{ id: 'cooking_line', label: 'Cooking Line', code: 'CE' }];
const prod = (over) => ({ id: 'T-100', category: 'cooking_line', name: 'Plain Table', unit: 'pc', specs: [], notes: 'SS304', ...over });
const render = (products, opts) => B.renderCatalogue({ categories: CATS, products }, { publicCategories: { products: Object.fromEntries(products.map((p) => [p.id, 'cooking'])), excludedProducts: {} }, ...(opts || {}) });
const cardOf = (html, id) => html.split('<li class="cat-card').slice(1).find((c) => c.includes(`data-id="${id}"`));

describe('every card says what it is, and shows its notes WHOLE under a label', () => {
  const LONG = 'Insulated SS304 proofer. Double-wall body, magnetic gasket door, thermostat plus humidity tray, electric heating element, 600x400 tray pitch, fibreglass insulation, temperature monitoring, adjustable footing, brushed finish.';
  const out = render([
    prod({ id: 'T-101', name: 'Long Note', notes: LONG }),
    prod({ id: 'T-102', name: 'Plain Item', notes: '' }),
    prod({ id: 'T-103', name: 'Material Only', notes: '', material: { grade: 'SS304', finish: 'No.4 brushed' } }),
    prod({ id: 'T-104', name: 'Both', notes: 'Pending full spec confirmation per project', material: { grade: 'SS304' } }),
  ]);

  it('puts the code, name and size line in a head, then a body holding the labelled note — the whole note, escaped, never cut', () => {
    const c = cardOf(out, 'T-101');
    assert.match(c, /<div class="cat-head"><p class="cat-code">T-101<\/p><h3>Long Note<\/h3><p class="cat-meta">per pc<\/p><\/div><div class="cat-body"><p class="cat-label">Notes<\/p><p class="cat-notes">/);
    assert.ok(c.includes(`<p class="cat-notes">${LONG}</p>`), 'the note was shortened or altered');
    assert.equal(B.LABEL_NOTES, 'Notes');
    assert.equal(B.LABEL_SPECS, 'Specifications');
  });

  it('a product with no note shows NO body, NO label and NO placeholder', () => {
    const c = cardOf(out, 'T-102');
    assert.ok(!c.includes('cat-body') && !c.includes('cat-label') && !c.includes('cat-notes'));
    assert.ok(!/coming soon|n\/a|none|tbc|no notes?/i.test(stripTags(c)), 'a placeholder text stands in for the missing note');
  });

  it('the material rows sit under a "Specifications" label, the note under "Notes" — each only when it exists', () => {
    assert.ok(cardOf(out, 'T-103').includes('<div class="cat-body"><p class="cat-label">Specifications</p><dl class="cat-specs"><div><dt>Grade</dt><dd>SS304</dd></div><div><dt>Finish</dt><dd>No.4 brushed</dd></div></dl></div>'));
    assert.ok(!cardOf(out, 'T-103').includes('>Notes<'));
    const both = cardOf(out, 'T-104');
    assert.ok(both.indexOf('<p class="cat-label">Notes</p>') < both.indexOf('<p class="cat-notes">') && both.indexOf('<p class="cat-notes">') < both.indexOf('<p class="cat-label">Specifications</p>') && both.indexOf('<p class="cat-label">Specifications</p>') < both.indexOf('<dl class="cat-specs">'));
  });

  it('on the committed page every note and every spec list is labelled, every label has something under it, and no card carries an empty body', () => {
    const cards = block.split('<li class="cat-card').slice(1);
    assert.equal(cards.length, 25);
    for (const c of cards) {
      const id = (c.match(/data-(?:id|family)="([^"]+)"/) || [])[1];
      assert.ok(c.includes('<div class="cat-head">'), `${id}: no head`);
      if (c.includes('<p class="cat-notes">')) assert.ok(c.includes('<p class="cat-label">Notes</p><p class="cat-notes">'), `${id}: a note without its label`);
      if (c.includes('<dl class="cat-specs">')) assert.ok(/<p class="cat-label">Specifications<\/p><dl class="cat-specs">/.test(c), `${id}: a spec list without its label`);
      assert.equal((c.match(/<p class="cat-label">/g) || []).length, (c.match(/<p class="cat-notes">|<dl class="cat-specs">/g) || []).length, `${id}: a label that labels nothing`);
      if (c.includes('<div class="cat-body">')) assert.ok(!c.includes('<div class="cat-body"></div>'), `${id}: an empty body`);
    }
  });

  it('every fixed card on the page that has a note shows it in full: the text under .cat-notes is the product note, character for character', () => {
    // the page is generated from the master through publicProduct(); the committed notes are the allowlisted notes (TEXT_FIXES applied), so compare against the generator's own output for the same text
    const notes = [...block.matchAll(/<li class="cat-card[^"]*" data-id="([^"]+)">[\s\S]*?<\/li>/g)].map((m) => [m[1], (m[0].match(/<p class="cat-notes">([^<]*)<\/p>/) || [])[1]]);
    assert.equal(notes.length, 14, 'the 14 fixed items left (the fryers, griddles, grillers and deck ovens are configurable families now)');
    const withNotes = notes.filter(([, n]) => n);
    assert.ok(withNotes.length >= 10, 'most fixed items have a note (12 of the 14)');
    for (const [id, n] of withNotes) assert.ok(!/\.\.\.|…|&hellip;/.test(decode(n)), `${id}: the note ends in an ellipsis`);
    // the longest notes on the page are all there (these three are the longest of the fixed items today)
    for (const [id, start] of [['BA-006', 'Insulated SS304 proofer. Double-wall body'], ['BA-011', 'Insulated SS304 proofer-retarder. Digital controls'], ['RF-003', 'Fan cooling, Embraco/R404A compressor']]) {
      const n = decode(notes.find(([i]) => i === id)[1]);
      assert.ok(n.startsWith(start) && n.length > 110, `${id}: the long note is not whole`);
    }
  });
});

describe('the placeholder is a small category line-icon — never a big letter', () => {
  it('has one icon per public category, drawn from path and circle only, with no comma-separated numbers (CHECK 9 reads "1,200" as a price)', () => {
    assert.deepEqual(Object.keys(B.TILE_ICONS).sort(), B.PUBLIC_CATEGORIES.map((c) => c.id).sort());
    for (const [id, svg] of Object.entries(B.TILE_ICONS)) {
      assert.ok(!/<(?!\/?(?:path|circle)\b)[a-z]/i.test(svg), `${id}: a tag other than path / circle`);
      assert.ok(!/\d,\d/.test(svg), `${id}: a comma between numbers`);
      assert.ok(!/\sstyle=|\son[a-z]+=|href=/i.test(svg));
    }
  });

  it('a product with no photo gets the icon of its category; a category with no icon of its own gets a plain box; a photo replaces the icon', () => {
    const html = render([prod({ id: 'T-110' })], { photos: { 'T-110': { src: 'site/img/products/a.webp', thumb: 'site/img/products/a-thumb.webp', width: 400, height: 300, mainWidth: 800 } } });
    assert.ok(!html.includes('cat-tile') && html.includes('<figure class="cat-photo">'));
    for (const catId of Object.keys(B.TILE_ICONS)) {
      const fam = B.renderFamilyCard(FAMS.families.rack, { id: catId }, null, '');
      assert.ok(fam.includes(B.TILE_ICONS[catId]), catId);
    }
    assert.ok(B.renderFamilyCard(FAMS.families.rack, { id: 'nope' }, null, '').includes('<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/>'));
  });

  it('the committed page has no letter tile anywhere, and every tile carries an icon', () => {
    assert.ok(!/<div class="cat-tile" aria-hidden="true"><span>/.test(block));
    const tiles = block.match(/<div class="cat-tile"[\s\S]*?<\/div>/g) || [];
    assert.equal(tiles.length, 15, '11 fixed items and the dish table, wok range, deck oven and cabinet have no photo yet');
    for (const t of tiles) assert.ok(t.includes('<svg class="cat-ic"') && !/<span/.test(t));
    assert.ok(!/\.cat-tile span\b/.test(css), 'the old big-letter rule is still in the stylesheet');
  });
});

describe('the configurable cards: featured, with a labelled Specifications list and the owner\'s material line', () => {
  const fams = [...block.matchAll(/<li class="cat-card cat-card-family cat-card-feature[^"]*" data-family="([a-z_]+)"[\s\S]*?<\/li>/g)];

  it('all eleven are featured cards, in order, each with tag, serif-name heading, lead paragraph and a Specifications list ending in Size and Material', () => {
    assert.deepEqual(fams.map((m) => m[1]), FAMS.order);
    for (const m of fams) {
      assert.match(m[0], /<div class="cat-head"><p class="cat-code cat-tag">Configurable<\/p><h3>[^<]+<\/h3><p class="cat-lead">[^<]{40,}<\/p><\/div>/, m[1]);
      assert.match(m[0], /<div class="cat-body"><p class="cat-label">Specifications<\/p><dl class="cat-specs">/, m[1]);
      // SEO build 2026-10-22: the card ends with a "Learn more" link to the family's product page, inside the same panel, after the Specifications list
      const page = B.FAMILY_PAGES[m[1]];
      assert.ok(page, `${m[1]}: no product page in FAMILY_PAGES`);
      assert.ok(m[0].includes(`<div><dt>Size</dt><dd>Made to your `) && m[0].endsWith(`<div><dt>Material</dt><dd>${B.FAMILY_MATERIAL}</dd></div></dl><p class="cat-learn"><a class="link-arrow" href="${page.path}">Learn more about ${page.about}</a></p></div></li>`), `${m[1]}: Size / Material rows, then the "Learn more" link`);
    }
  });

  it('STANDARD CONSTRUCTION: each card lists the PUBLIC options, then Size, then Construction (the owner\'s sentence at the family defaults), then Material LAST — and never the staff-only top plate', () => {
    const CONSTRUCTION = {
      prep_table: 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelves and upper shelves · square-tube posts with adjustable bullet feet',
      sink: 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelf, upper shelf and panels · square-tube posts with adjustable bullet feet',
      stove: 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm body and panels · square-tube posts with adjustable bullet feet',
      cabinet: 'SS304 stainless steel · 1.2 mm body, doors and shelves · square-tube posts with adjustable bullet feet',
      wall_shelf: 'SS304 stainless steel · 1.2 mm shelves · fixed to the wall',
      rack: 'SS304 stainless steel · 1.2 mm shelves · square-tube frame · on wheels',
      dish_table: 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelf and splash · raised back and side splash, clean-dish landing · square-tube posts with adjustable bullet feet',
      wok_range: 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm body and panels · recessed wok rings with high-pressure burners · square-tube posts with adjustable bullet feet',
      cooking_line: 'SS304 stainless steel · 1.2 mm body and panels · semi-non-stick griddle plate, gas-fired · square-tube stand with adjustable bullet feet',
      deck_oven: 'Insulated double-wall decks with a gas burner, gas valve and thermometer per deck · stainless steel outer body · set on your own base',
      hood: 'SS304 stainless steel · welded canopy with grease trough and oil cup · wall-mounted canopy · stainless baffle grease filters',
    };
    assert.equal(fams.length, 11);
    for (const m of fams) {
      const fam = FAMS.families[m[1]];
      const rows = [...m[0].matchAll(/<div><dt>([^<]*)<\/dt><dd>([^<]*)<\/dd><\/div>/g)].map((x) => [decode(x[1]), decode(x[2])]);
      assert.deepEqual(rows.map((r) => r[0]), [...PF.publicGroups(fam).map((g) => g.label), 'Size', 'Construction', 'Material'], m[1]);
      assert.equal(rows.find((r) => r[0] === 'Construction')[1], CONSTRUCTION[m[1]], `${m[1]}: the Construction row`);
      assert.equal(rows.find((r) => r[0] === 'Construction')[1], PF.constructionLine(fam, PF.defaultConfig(fam)), `${m[1]}: it is the helper\'s sentence at the defaults`);
      // the staff-only option is not offered here, and nothing on a card says "staff" or names the lighter choice
      assert.ok(!m[0].includes('Top plate'), `${m[1]}: the staff-only group has a row on the card`);
      assert.ok(!/staff|lighter|cheaper|1\.2 mm top/i.test(m[0]), `${m[1]}: a card mentions the staff-only choice`);
    }
    // a conditional option (spec §4.1) is still ONE row, and says when it applies (the row count above is already one per public group)
    const rowOf = (fid, label) => decode([...fams.find((m) => m[1] === fid)[0].matchAll(/<div><dt>([^<]*)<\/dt><dd>([^<]*)<\/dd><\/div>/g)].find((x) => decode(x[1]) === label)[2]);
    assert.equal(rowOf('cooking_line', 'Fry baskets'), '1 / 2 / 3 (Type is Fryer)');
    assert.equal(rowOf('cooking_line', 'Burners'), '1 / 2 / 3 (Type is Griddle or Lava-rock griller)');
    assert.equal(rowOf('dish_table', 'Pre-rinse sink'), 'None / With pre-rinse sink and spray faucet (Side is Soiled)');
    assert.equal(rowOf('cooking_line', 'Type'), 'Griddle / Lava-rock griller / Fryer / Griller + griddle', 'an unconditional option has no suffix');
    for (const m of fams) for (const g of PF.publicGroups(FAMS.families[m[1]])) assert.equal(rowOf(m[1], g.label).endsWith(` (${PF.whenText(FAMS.families[m[1]], g)})`), !!g.when, `${m[1]}.${g.key}: the condition shows exactly on the conditional rows`);
    // the GENERATOR does the same for any family: a staff-only group never gets a row, and a family with no sentence gets no Construction row
    const sinkCard = B.renderFamilyCard(FAMS.families.sink, { id: 'washing' }, null, '');
    assert.ok(!sinkCard.includes('<dt>Top plate</dt>') && sinkCard.includes('<dt>Construction</dt>'));
    const bare = B.renderFamilyCard({ ...FAMS.families.sink, construction: undefined }, { id: 'washing' }, null, '');
    assert.ok(!bare.includes('<dt>Construction</dt>') && !bare.includes('<dt>Top plate</dt>'));
    // pinned order in the markup itself: Size, then Construction, then Material, then the "Learn more" link
    assert.ok(sinkCard.indexOf('<dt>Size</dt>') < sinkCard.indexOf('<dt>Construction</dt>') && sinkCard.indexOf('<dt>Construction</dt>') < sinkCard.indexOf('<dt>Material</dt>') && sinkCard.indexOf('<dt>Material</dt>') < sinkCard.indexOf('cat-learn'));
  });

  it('the Material line is the owner\'s OWN statement of what is offered (SS304 food-grade as standard, SS316 laboratory-grade; brushed, mirror or satin finish) — never a claim the homepage does not make', () => {
    assert.equal(B.FAMILY_MATERIAL, 'SS304 food-grade (standard) or SS316 laboratory-grade · brushed, mirror or satin finish');
    const proof = stripTags(home.match(/<ul class="proof-bar"[\s\S]*?<\/ul>/)[0]);
    for (const word of ['SS304', 'SS316', 'food-grade', 'laboratory-grade']) assert.ok(proof.includes(word), `the proof bar no longer says "${word}"`);
    const homeText = stripTags(home.slice(home.indexOf('<div id="site"'), home.indexOf('<!-- /#site -->')));
    for (const word of ['brushed', 'mirror', 'satin']) assert.ok(homeText.includes(word), `the homepage no longer names the ${word} finish`);
    assert.match(stripTags(block), /Premium stainless-steel equipment in food-grade SS304 as standard, or laboratory-grade SS316/);
  });

  it('the family description is the same text the data file holds (nothing invented on the card)', () => {
    for (const m of fams) assert.ok(m[0].includes(`<p class="cat-lead">${B.esc(FAMS.families[m[1]].description)}</p>`), m[1]);
  });

  it('the GENERATOR marks a category that holds two or more configurable products — and only that one — for the side-by-side row', () => {
    const products = [prod({ id: 'T-130' })];
    const pub = { products: { 'T-130': 'cooking' }, excludedProducts: {} };
    const fams = (ids) => ({ order: ids, families: Object.fromEntries(ids.map((i) => [i, FAMS.families[i]])), absorbedIds: new Set(), fixedIds: new Set(['T-130']), familyOfSku: new Map(), photoOf: Object.fromEntries(ids.map((i) => [i, null])) });
    const two = B.renderCatalogue({ categories: CATS, products }, { publicCategories: pub, families: fams(['cabinet', 'rack']) });
    assert.match(two, /<section class="cat-group" id="cat-storage"[\s\S]*?<ul class="cat-grid cat-grid-multi">/);
    assert.match(two, /<section class="cat-group" id="cat-cooking"[\s\S]*?<ul class="cat-grid">/);
    assert.equal((two.match(/cat-grid-multi/g) || []).length, 1);
    const one = B.renderCatalogue({ categories: CATS, products }, { publicCategories: pub, families: fams(['cabinet']) });
    assert.ok(!one.includes('cat-grid-multi'), 'a lone configurable product must stay the wide featured card');
    for (const html of [one, two]) assert.equal((html.match(/cat-card-feature/g) || []).length, html === one ? 1 : 2);
  });

  it('only a category that holds SEVERAL configurable products gets the side-by-side row (Washing, Cooking, Storage); a lone one (Preparation, Ventilation) is the wide featured card', () => {
    const grids = [...block.matchAll(/<section class="cat-group" id="cat-([a-z]+)"[\s\S]*?<ul class="(cat-grid[^"]*)">/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(grids, [['preparation', 'cat-grid'], ['washing', 'cat-grid cat-grid-multi'], ['cooking', 'cat-grid cat-grid-multi'], ['ventilation', 'cat-grid'], ['storage', 'cat-grid cat-grid-multi'], ['refrigeration', 'cat-grid']]);
    const one = render([prod({ id: 'T-120' })], { families: null });
    assert.ok(!one.includes('cat-grid-multi'));
  });
});

describe('css/catalogue.css — notes are never cut, never small, never pale', () => {
  const noteSelectors = ['#site .cat-notes', '#site .cat-lead', '#site .cat-specs', '#site .cat-meta'];

  it('shows the whole note: no line-clamp, no ellipsis, no fixed or maximum height, no hiding, on any card or text selector', () => {
    for (const bad of ['line-clamp', 'text-overflow', 'box-orient', 'mask-image']) assert.ok(!css.includes(bad), `the stylesheet uses ${bad}`);
    const TEXTY = /\.cat-(?:card|body|head|notes|lead|specs|label|meta)\b/;           // the containers of TEXT (the image well's <img> is sized to its well, which is not text)
    for (const r of RULES) {
      const target = r.selector.split(/\s*[> ]\s*/).pop();                  // what the rule is FOR: the last compound selector (an icon inside a card is not text)
      if (!TEXTY.test(target) && !/^h3$/.test(target)) continue;
      assert.ok(!('height' in r.decls) && !('max-height' in r.decls), `${r.selector} has a height: ${r.decls.height || r.decls['max-height']}`);
      if (r.decls.display === 'none') assert.ok(/\.is-hidden|\.cat-tile/.test(r.selector), `${r.selector}{display:none} hides content`);
    }
  });

  it('keeps every note-bearing text at 14px or more: the notes and lead paragraph, the spec rows and the size line', () => {
    for (const s of noteSelectors) {
      const sizes = RULES.filter((r) => r.selector === s && 'font-size' in r.decls).map((r) => px(r.decls['font-size']));
      assert.ok(sizes.length > 0, `${s} has no font-size`);
      for (const n of sizes) assert.ok(n >= 14, `${s} is ${n}px`);
    }
    const sized = RULES.filter((r) => /\.cat-(?:notes|lead|specs|meta)\b/.test(r.selector) && 'font-size' in r.decls);
    for (const r of sized) assert.ok(px(r.decls['font-size']) >= 14, `${r.selector} is ${r.decls['font-size']}`);
    assert.equal(merged('#site .cat-notes').color, 'var(--cat-ink)');
    assert.equal(merged('#site .cat-notes')['font-size'], '14.5px');
  });

  it('uses a near-black for the notes that passes 7:1 (AAA) on both the white card and the pale notes panel', () => {
    const ink = (css.match(/--cat-ink:(#[0-9A-Fa-f]{6})/) || [])[1];
    assert.ok(ink, 'no --cat-ink token');
    for (const ground of ['#FFFFFF', '#FAF8F4']) assert.ok(contrast(ink, ground) >= 7, `notes ink ${ink} on ${ground}: ${contrast(ink, ground).toFixed(1)}:1`);
    assert.ok(contrast('#4A5260', '#FFFFFF') >= 7, 'the size line colour');
    assert.equal(merged('#site .cat-meta').color, '#4A5260');
  });

  it('labels the notes in small gold caps (the same gold ink as the code), so the label reads as a heading for what follows', () => {
    const l = merged('#site .cat-label');
    assert.equal(l.color, 'var(--site-gold-ink)');
    assert.match(l.font, /^600 11\.5px/);
    assert.equal(l['text-transform'], 'uppercase');
    assert.ok(contrast('#85690F', '#FAF8F4') >= 4.5, 'the gold ink label is below AA on the notes panel');
  });
});

describe('css/catalogue.css — the layouts', () => {
  it('a phone gets ONE column and the compact card (well | text); a product with no photo has no well at all there', () => {
    assert.equal(merged('#site .cat-grid')['grid-template-columns'], 'minmax(0,1fr)');
    assert.equal(merged('#site .cat-card')['grid-template-columns'], 'var(--cat-well) minmax(0,1fr)');
    const m = '(max-width:719px)';
    assert.equal(merged('#site .cat-card:not(.has-photo):not(.cat-card-feature)', m)['grid-template-columns'], 'minmax(0,1fr)');
    assert.equal(merged('#site .cat-card:not(.has-photo):not(.cat-card-feature) > .cat-tile', m).display, 'none');
    assert.equal(merged('#site .cat-card:not(.cat-card-feature) > .cat-body > .cat-label:first-child', m).display, 'inline', 'the Notes label runs in on a phone');
    assert.ok(!/repeat\(3,/.test(css), 'the old three-column grid of tall cards is back');
    // a configurable card on a phone: the "Configurable" tag shares the name's line (at the right) instead of taking a row of its own
    assert.equal(merged('#site .cat-card-feature > .cat-head > .cat-tag', m)['grid-column'], '2');
    assert.equal(merged('#site .cat-card-feature > .cat-head > h3', m)['grid-row'], '1');
    assert.equal(merged('#site .cat-card-feature > .cat-head > .cat-lead', m)['grid-row'], '2');
  });

  it('from 720px a fixed item is one spec row: well | name column (never narrower than its size line) | notes | button column reserved in advance', () => {
    const c = merged('#site .cat-card', MIN720);
    assert.equal(c['grid-template-columns'], 'var(--cat-well) minmax(244px,40fr) minmax(0,46fr) minmax(172px,auto)');
    assert.equal(c['grid-template-rows'], 'auto');
    assert.equal(merged('#site .cat-card > .cat-body', MIN720)['grid-column'], '3');
    assert.equal(merged('#site .cat-card > .qr-add', MIN720)['grid-column'], '4');
    assert.equal(merged('#site .cat-grid', MIN720)['grid-template-columns'], undefined, 'the grid stays one column: rows, not tall cards');
    // and the button is centred on the row with side margins, not floating at the bottom of an empty card
    assert.equal(merged('#site .cat-card > .qr-add', MIN720)['align-self'], 'center');
    assert.match(qrCss, /@media \(min-width:720px\)\{[^@]*#site \.cat-card > \.qr-add\{margin:0 14px;min-height:40px\}/);
  });

  it('the featured card: stacked on a phone, a 45 / 55 wide row from 720px with the text block centred between two spacer rows', () => {
    assert.equal(merged('#site .cat-card-feature').display, 'flex');
    assert.equal(merged('#site .cat-card-feature')['flex-direction'], 'column');
    assert.equal(merged('#site .cat-card-feature')['grid-column'], '1 / -1');
    const w = merged('#site .cat-card-feature', MIN720);
    assert.equal(w.display, 'grid');
    assert.equal(w['grid-template-columns'], 'minmax(0,45fr) minmax(0,55fr)');
    assert.equal(w['grid-template-rows'], 'minmax(22px,1fr) auto auto auto minmax(22px,1fr)');
    assert.equal(merged('#site .cat-card-feature > .cat-photo', MIN720)['grid-row'], '1 / -1');
    // the name is the serif at a larger size (a phone keeps the normal sans name)
    assert.match(merged('#site .cat-card-feature h3', MIN720).font, /var\(--site-serif\)/);
    assert.equal(merged('#site .cat-card h3').font.includes('var(--site-sans)'), true);
    // the photo is contained on the soft neutral ground, centred (never cropped)
    assert.equal(merged('#site .cat-photo img')['object-fit'], 'contain');
    assert.equal(merged('#site .cat-card-feature > .cat-photo img')['object-position'], 'center');
    assert.equal(merged('#site .cat-card').overflow, 'hidden');
  });

  it('several configurable products in one category sit side by side where the column is wide enough (and the wide cards take over narrower than that)', () => {
    assert.ok(RULES.some((r) => r.media === MULTI), 'the multi media query is gone');
    assert.equal(merged('#site .cat-grid-multi', MULTI)['grid-template-columns'], 'repeat(auto-fit,minmax(240px,1fr))');
    assert.equal(merged('#site .cat-grid-multi > .cat-card-feature', MULTI).display, 'flex');
    assert.equal(merged('#site .cat-grid-multi > .cat-card-feature', MULTI)['grid-column'], 'auto');
    assert.equal(merged('#site .cat-grid-multi > .cat-card-feature > .cat-body', MULTI).flex, '1', 'the Specifications panel grows so the cards in the row are one height');
    assert.equal(merged('#site .cat-grid-multi', MIN720)['grid-template-columns'], undefined, 'below the multi breakpoints the wide cards are not squeezed into columns');
  });

  it('the specification rows read "Label: value" in a narrow card and line up in two columns where there is room', () => {
    assert.equal(merged('#site .cat-specs dt').display, 'inline');
    assert.equal(merged('#site .cat-specs dt::after').content, '": "');
    assert.equal(merged('#site .cat-specs', MIN720)['grid-template-columns'], 'max-content minmax(0,1fr)');
    assert.equal(merged('#site .cat-specs dt::after', MIN720).content, 'none');
    assert.equal(merged('#site .cat-grid-multi .cat-specs dt::after', MULTI).content, '": "');
  });

  it('the "In your quote" badge never sits on the button or the notes: top-right of a row, on the photo of a featured card', () => {
    assert.match(qrCss, /#site \.cat-card\[data-qr-count\]::after\{\s*content:"In your quote[^}]*top:8px;right:8px/);
    assert.match(qrCss, /#site \.cat-card\.cat-card-feature\[data-qr-count\]::after\{top:10px;right:auto;left:10px\}/);
  });
});

describe('css/catalogue.css — tighter spacing (upper bounds, so the dead space cannot creep back)', () => {
  const clampMax = (v) => parseFloat(String(v).match(/clamp\([^,]+,[^,]+,\s*([\d.]+)px\)/)[1]);

  it('keeps the gap between category sections to 48px at most, the heading block tight, and the page padding modest', () => {
    assert.ok(clampMax(merged('#site .cat-group+.cat-group')['margin-top']) <= 48);
    const h2 = merged('#site .cat-group h2');
    assert.ok(px(h2['padding-bottom']) <= 12 && /^\d+px 0 \d+px$/.test(h2.margin) && px(h2.margin.split(' ')[2]) <= 16);
    assert.ok(clampMax(merged('#site .cat-layout')['padding-bottom']) <= 64);
    assert.ok(clampMax(merged('#site .cat-cta').padding.replace(' 0', '')) <= 72);
    assert.ok(clampMax(merged('#site .cat-intro').padding.split(' 0 ')[0]) <= 56);
  });

  it('keeps a card compact: the image well is at most 116px tall at its smallest, the card gap is 10px or less, the row gap 8px', () => {
    assert.ok(px(merged('#site .cat-photo')['min-height']) <= 116 && px(merged('#site .cat-tile .cat-ic').width) <= 32);
    assert.ok(px(merged('#site .cat-grid')['gap']) <= 10 && px(merged('#site .cat-grid', MIN720)['gap']) <= 10);
    assert.ok(px(merged('#site .cat-card')['row-gap']) <= 10);
    assert.ok(!('aspect-ratio' in merged('#site .cat-tile')) && !('aspect-ratio' in merged('#site .cat-photo')), 'the old 16:10 image slot is back');
  });
});

// ── SEARCH: the REAL js/catalogue.js over the REAL generated page, in a tiny fake DOM ─────────────────────────────────────────────────────
function parseHtml(html) {
  const mk = (tag, attrs) => {
    const el = {
      tag, attrs, children: [], parent: null, text: '', hidden: false, value: '', _h: {},
      getAttribute(k) { return k in attrs ? attrs[k] : null; }, setAttribute(k, v) { attrs[k] = String(v); }, removeAttribute(k) { delete attrs[k]; }, hasAttribute(k) { return k in attrs; },
      get className() { return attrs.class || ''; },
      classList: {
        contains: (c) => (attrs.class || '').split(/\s+/).includes(c),
        add: (c) => { const s = new Set((attrs.class || '').split(/\s+/).filter(Boolean)); s.add(c); attrs.class = [...s].join(' '); },
        remove: (c) => { attrs.class = (attrs.class || '').split(/\s+/).filter((x) => x && x !== c).join(' '); },
        toggle: (c, force) => { const has = (attrs.class || '').split(/\s+/).includes(c); const want = force === undefined ? !has : !!force; if (want && !has) el.classList.add(c); if (!want && has) el.classList.remove(c); return want; },
      },
      get textContent() { return el.children.length ? el.children.map((c) => c.textContent).join('') : el.text; },
      set textContent(v) { el.children = []; el.text = String(v); },
      get parentNode() { return el.parent; },
      matches(sel) { return sel.split(',').some((s) => { s = s.trim(); return s.startsWith('.') ? el.classList.contains(s.slice(1)) : s === tag; }); },
      querySelectorAll(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); }); walk(el); return out; },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
      addEventListener(ev, fn) { (el._h[ev] = el._h[ev] || []).push(fn); },
      getBoundingClientRect() { return { top: 0, height: 0, left: 0, width: 0 }; },
      focus() {}, blur() {}, select() {}, scrollTo() {}, scrollIntoView() {},
    };
    return el;
  };
  const root = mk('#root', {});
  let cur = root;
  const VOID = new Set(['img', 'input', 'br', 'path', 'circle']);
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) { cur = cur.parent || root; }
    else if (m[2]) {
      const attrs = {};
      for (const a of (m[3] || '').matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : decode(a[2]);
      const el = mk(m[2].toLowerCase(), attrs); el.parent = cur; cur.children.push(el);
      if (!(m[4] || VOID.has(el.tag))) cur = el;
    } else if (m[5] && m[5].trim()) { const t = mk('#text', {}); t.text = decode(m[5]); t.parent = cur; cur.children.push(t); }
  }
  return root;
}

function runCatalogueScript() {
  const tree = parseHtml(block);
  const byId = {};
  const index = (n) => { if (n.attrs && n.attrs.id) byId[n.attrs.id] = n; n.children.forEach(index); };
  index(tree);
  const timers = [];
  const win = {
    innerWidth: 1440, innerHeight: 900, pageYOffset: 0,
    matchMedia: () => ({ matches: false }), requestAnimationFrame: (fn) => { fn(); }, getComputedStyle: () => ({ position: 'static', scrollMarginTop: '0' }),
    addEventListener() {}, scrollTo() {}, setInterval: () => 0, clearInterval() {},
  };
  const doc = { readyState: 'complete', getElementById: (id) => byId[id] || null, addEventListener() {}, fonts: null };
  const sandbox = { window: win, document: doc, location: { hash: '' }, Date, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: (id) => { timers[id - 1] = null; }, setInterval: () => 0, clearInterval() {} };
  vm.runInNewContext(catJs, sandbox);
  const input = byId['cat-search'];
  const cards = tree.querySelectorAll('.cat-card');
  const idOf = (c) => c.getAttribute('data-id') || c.getAttribute('data-family');
  const search = (q) => {
    input.value = q;
    for (const h of input._h.input || []) h();
    for (let i = 0; i < timers.length; i++) if (timers[i]) { const f = timers[i]; timers[i] = null; f(); }
    return cards.filter((c) => !c.classList.contains('is-hidden')).map(idOf);
  };
  return { search, byId, tree, idOf, cards };
}

describe('search finds every card — the featured ones included — by running the real js/catalogue.js on the real page', () => {
  const env = runCatalogueScript();
  const ALL = env.cards.map(env.idOf);

  it('starts with every card shown, and a blank query restores them all', () => {
    assert.equal(ALL.length, 25);
    assert.deepEqual(env.search(''), ALL);
  });

  it('finds a configurable card by its name, its lead paragraph, its option rows, its Material row and the codes of the products it replaced', () => {
    assert.ok(env.search('stove').includes('stove'));
    assert.ok(env.search('burner position').includes('stove'), 'the lead paragraph is searched');
    assert.ok(env.search('griller').includes('stove'), 'the option rows are searched');
    assert.deepEqual(env.search('wheels'), ['rack']);
    assert.deepEqual(env.search('pw-006'), ['sink'], 'the absorbed SKU code finds the family that replaced it');
    assert.deepEqual(env.search('double sink'), ['sink']);
    const ss304 = env.search('ss304');
    for (const f of FAMS.order) assert.ok(ss304.includes(f), `${f} is not found by its Material row`);
    assert.deepEqual(env.search('worktable'), ['prep_table']);
  });

  it('still finds fixed cards by code, name, size line and note — and not by the "Notes" / "Specifications" labels or the photo caption', () => {
    assert.deepEqual(env.search('ce-016'), ['deck_oven'], 'the code of an absorbed SKU finds the family that replaced it');
    assert.deepEqual(env.search('ba-011'), ['BA-011']);
    assert.ok(env.search('griddle').includes('cooking_line'));
    assert.ok(env.search('700 × 800').includes('BA-006'), 'the size line is searched');
    assert.ok(env.search('baking').includes('BA-006') === false && env.search('humidity tray').includes('BA-006'), 'the note is searched');
    assert.ok(env.search('retard then proof').includes('BA-011') && env.search('supplied by partner').includes('BA-011'), 'the end of the longest note is searched');
    assert.deepEqual(env.search('representative'), [], 'the photo caption is not searchable');
    assert.ok(!env.search('notes').includes('BA-006'), 'the label "Notes" is not searchable text');
    assert.ok(!env.search('specifications').includes('stove'), 'the label "Specifications" is not searchable text');
  });

  it('hides the cards that do not match, empties a category with no match, updates the counts and shows the empty state — and a configurable card reappears when the search is cleared', () => {
    const one = env.search('rack');
    assert.ok(one.includes('rack') && !one.includes('stove') && !one.includes('BA-006'));
    const storage = env.byId['cat-storage'];
    env.search('zzzz-no-such-product');
    for (const g of ['cat-preparation', 'cat-washing', 'cat-cooking', 'cat-ventilation', 'cat-storage', 'cat-refrigeration']) assert.ok(env.byId[g].classList.contains('is-empty'), g);
    assert.equal(env.byId['cat-empty'].hidden, false);
    assert.equal(env.byId['cat-empty-q'].textContent, 'zzzz-no-such-product');
    assert.match(env.byId['cat-status'].textContent, /^No results for/);
    env.search('cabinet');
    assert.equal(storage.classList.contains('is-empty'), false);
    assert.equal(env.byId['cat-preparation'].classList.contains('is-empty'), true);
    assert.deepEqual(env.search(''), ALL);
    assert.equal(env.byId['cat-empty'].hidden, true);
  });

  it('js/catalogue.js reads the lead paragraph (the haystack selector names .cat-lead) and the page keeps the data-cat / data-id / data-family hooks it and js/quote-request.js use', () => {
    assert.match(catJs, /querySelectorAll\('\.cat-code, h3, \.cat-meta, \.cat-notes, \.cat-lead, \.cat-specs'\)/);
    assert.equal((block.match(/<li class="cat-card[^"]*" data-(?:id|family)="/g) || []).length, 25);
    assert.equal((block.match(/data-kw="/g) || []).length, 11);
    assert.ok(/cards\[i\]\.parentNode\.parentNode\.getAttribute\('data-cat'\)/.test(catJs), 'the card -> grid -> section hop catalogue.js counts by');
    assert.ok(!/<li class="cat-card[^>]*><div/.test(block.replace(/<li class="cat-card[^>]*>(?:<figure|<div class="cat-tile")/g, '')), 'a card starts with something other than its image well');
  });
});
