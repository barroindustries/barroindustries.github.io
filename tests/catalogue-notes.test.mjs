// tests/catalogue-notes.test.mjs — "Barro Kitchens – Website Notes (Nov 19, 2026)" applied to /catalogue/ (owner approved): every card follows
//   photo · tag(s) · name · CODE line · one sentence · "Standard size:" line · 3-4 key specs · "Options:" line · Learn more · price line · button
// with exactly the data the Notes give, and three featured hero products (Pugon pandesal oven, Teppanyaki grill, Inasal charcoal grill) first in Chef Mode.
// The codes, sizes and options are pinned LITERALLY below (the Notes are the source): change a card's data and this fails until the Notes say the same.
// Mutation-checked: a card's code removed / a thousands comma in a size / a hero card moved out of first place / "premium" back in the lede: each fails a test here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const { CARD_COPY, PROJECT_CARDS } = require('../scripts/catalogue-cards.js');
const page = read('catalogue/index.html');
const block = page.slice(page.indexOf('<!-- CATALOGUE:START'), page.indexOf('<!-- CATALOGUE:END'));
const cards = block.split('<li class="cat-card').slice(1).map((c) => c.split('</li>\n')[0] + '</li>');
const keyOf = (c) => (c.match(/data-(?:family|id|ask)="([^"]+)"/) || [])[1];
const BY = Object.fromEntries(cards.map((c) => [keyOf(c), c]));
const line = (c, cls) => { const m = c.match(new RegExp(`<p class="${cls}">([\\s\\S]*?)</p>`)); return m ? decode(m[1].replace(/<[^>]+>/g, '')) : null; };

// id -> [code | null, size | null, options | null]  (the Notes' data; "—" is null)
const NOTES = {
  prep_table: ['PS-PT-900', '900 × 600 × 850 mm', 'Lengths up to 1800 mm, up to two upper shelves, backsplash, SS316 on request'],
  sink: ['WS-SK1-600', '600 × 600 × 850 mm', 'One to four bowls, drainboard, undershelf and upper shelf, pre-rinse spray faucet'],
  dish_table: [null, null, 'Pre-rinse sink with spray faucet, undershelf, your length'],
  hood: ['VN-HD-1200', '1200 × 900 × 500 mm', 'Lengths 1.2 to 3.0 m, wall or island canopy'],
  stove: ['CK-LP-2', '750 mm deep, 850 mm high', '2, 4 or 6 burners, oven below'],
  wok_range: ['CK-WK-1', '600 × 750 × 850 mm', '1 to 3 holes, rear stock burner'],
  cooking_line: ['CK-GD-600', '600 × 750 × 850 mm', 'Griddle 600 or 900 mm, fryer with 1 or 2 vats, lava-rock griller'],
  cabinet: ['PS-CBW-900', '900 × 350 × 600 mm', 'Floor or wall, 900 to 1500 mm, swing or sliding doors'],
  wall_shelf: ['PS-RKW-1200', '1200 × 300 mm', 'One to three tiers, solid or slotted'],
  rack: ['PS-RK-900', '900 × 500 × 1800 mm', 'Lengths up to 1500 mm, slotted shelves, wheels'],
  station: [null, 'Built to your layout', 'Layout, length and modules agreed with you'],
  exhaust: [null, 'Designed per kitchen', 'Black-iron grease duct, insulated fresh-air duct'],
  trolley: ['PS-TR-UT', '900 × 500 × 900 mm', 'Food-service, dish-collection or tray-rack trolley'],
  noodle_boiler: ['CK-NB-6', null, 'With or without baskets'],
  combi_stove: ['CK-CB-1800', '1800 mm wide', null],
  pugon: ['BK-PG-1', '4 trays of 40 × 60 cm per deck', '1 deck (4 trays) or 2 decks (8 trays)'],
  teppanyaki: ['CK-TP-900', '900 × 750 × 850 mm', '900 or 1200 mm wide'],
  inasal: ['GR-CH-900', '900 mm long', '900, 1200 or 1500 mm long'],
  'CE-030': ['CK-SL', '660 × 400 × 400 mm', null],
  'CE-011': ['CK-RS-6', null, '12-tray model'],
};
const NO_DATA = ['CE-024', 'CE-031', 'MS-015', 'MS-016', 'BA-006', 'BA-011', 'RF-001', 'RF-002', 'RF-003', 'RF-004', 'RF-005', 'RF-006'];   // fixed items: no code, no size, no options

describe('the cards carry the Website Notes data', () => {
  it('has 32 cards, each with the code line iff the Notes give a code, the size line and the options line only where they give one', () => {
    assert.equal(cards.length, 32);
    for (const [id, [code, size, options]] of Object.entries(NOTES)) {
      const c = BY[id];
      assert.ok(c, `${id}: no card`);
      assert.equal(line(c, 'cat-code'), code, `${id}: code`);
      assert.equal(c.includes('<p class="cat-code">'), code !== null);
      assert.equal(line(c, 'cat-size'), size === null ? null : `Standard size: ${size}`, `${id}: size`);
      assert.equal(line(c, 'cat-options'), options === null ? null : `Options: ${options}`, `${id}: options`);
    }
    for (const id of NO_DATA) for (const k of ['cat-code', 'cat-size', 'cat-options']) assert.ok(!BY[id].includes(`<p class="${k}">`), `${id}: has a ${k}`);
    assert.equal(Object.keys(NOTES).length + NO_DATA.length, 32);
  });

  it('puts the code right under the name, then the sentence; the size and the options frame the specs; every card has three or four specs', () => {
    for (const c of cards) {
      const id = keyOf(c);
      const h = c.indexOf('<h3>'), code = c.indexOf('<p class="cat-code">'), lead = c.indexOf('<p class="cat-lead">');
      assert.ok(h < lead, id);
      if (code >= 0) assert.ok(h < code && code < lead, `${id}: the code line is between the name and the sentence`);
      const specs = (c.match(/<ul class="cat-feat">([\s\S]*?)<\/ul>/)[1].match(/<li>/g) || []).length;
      assert.ok(specs >= 3 && specs <= 4, `${id}: ${specs} specs`);
      assert.ok(c.indexOf('<p class="cat-size">') < 0 || (lead < c.indexOf('<p class="cat-size">') && c.indexOf('<p class="cat-size">') < c.indexOf('<ul class="cat-feat">')), `${id}: size`);
      assert.ok(c.indexOf('<p class="cat-options">') < 0 || c.indexOf('<ul class="cat-feat">') < c.indexOf('<p class="cat-options">') && c.indexOf('<p class="cat-options">') < c.indexOf('<p class="cat-from'), `${id}: options`);
    }
  });

  it('leads Chef Mode with the three featured hero products (Pugon pandesal oven, Teppanyaki grill, Inasal charcoal grill) at 53000, 62000 and 50000, tagged Featured; the range hood is Featured too', () => {
    const cooking = block.match(/<section class="cat-group" data-cat="cooking"[\s\S]*?<\/section>/)[0];
    const order = [...cooking.matchAll(/<li class="cat-card[^"]*" data-(?:family|id|ask)="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(order.slice(0, 4), ['pugon', 'teppanyaki', 'inasal', 'stove']);
    const prices = JSON.parse(read('scripts/public-from-prices.json')).prices;
    for (const [id, name, amount, row] of [['pugon', 'Pugon pandesal oven', 53000, 'BK-PG-1'], ['teppanyaki', 'Teppanyaki grill', 62000, 'CK-TP-900'], ['inasal', 'Inasal charcoal grill', 50000, 'GR-CH-900']]) {
      assert.deepEqual(prices[id].from, amount);
      assert.ok(prices[id].note.includes(row), `${id}: the note names the price-list row`);
      assert.ok(BY[id].includes(`<p class="cat-tag">Featured</p><h3>${name}</h3>`), `${id}: tag and name`);
      assert.ok(BY[id].includes(`<data value="${amount}">₱${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</data>`), `${id}: price line`);
      assert.ok(BY[id].includes('href="#request-quote"'), `${id}: a quote-request card`);
    }
    assert.ok(BY.hood.includes('<p class="cat-tag">Configurable</p><p class="cat-tag cat-tag-featured">Featured</p>'));
    assert.equal(PROJECT_CARDS.filter((p) => p.first).map((p) => p.id).join(), 'pugon,teppanyaki,inasal');
    // the JSON-LD item list follows the page order
    const ld = JSON.parse(page.match(/"@type":"ItemList"[\s\S]*?(?=<\/script>)/) ? '{' + page.match(/"@type":"ItemList"[\s\S]*?\]\}(?=<\/script>)/)[0] : '{}');
    const names = ld.itemListElement.map((i) => i.name);
    assert.deepEqual(names.slice(names.indexOf('Pugon pandesal oven'), names.indexOf('Pugon pandesal oven') + 4), ['Pugon pandesal oven', 'Teppanyaki grill', 'Inasal charcoal grill', 'Stove']);
  });
});

describe('the words stay plain', () => {
  const visible = block.replace(/<p class="cat-from[ "][^>]*>.*?<\/p>/g, '').replace(/<[^>]+>/g, ' ');
  it('has no "premium", "world-class" or "high quality" on the catalogue page, and uses the plain lede', () => {
    assert.ok(!/premium|world-class|high[- ]quality/i.test(visible + page.slice(0, page.indexOf('</head>')).replace(/<style[\s\S]*?<\/style>/, '')), 'a hype word on /catalogue/');
    assert.ok(block.includes('<p class="cat-lede">Commercial kitchen equipment for restaurants, hotels, bakeries, catering and commissary kitchens, built by our own team in SS304 stainless steel (SS316 on request) and built to your sizes.'));
  });
  it('has no number with a thousands comma, and no peso sign, anywhere in the catalogue block outside the price lines', () => {
    assert.ok(!/\b\d{1,3}(,\d{3})+\b|₱/.test(visible), 'money-like text outside the price lines');
    for (const c of [...Object.values(CARD_COPY), ...PROJECT_CARDS]) for (const t of [c.code, c.size, c.options, c.desc, ...c.specs]) assert.ok(!t || !/\d,\d{3}/.test(t), t);
  });
  it('shows no panel gauge or sheet-number wording the Notes rule out (G#22, 16 ga, 1.2 mm panels); the pugon\'s pressure gauge is a part the Notes themselves name', () => {
    assert.ok(!/\bG#\s?\d|\b\d+\s?ga\b|\bgauge\s?\d/i.test(visible), 'a panel gauge is on a card');
  });
});
