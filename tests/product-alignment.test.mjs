// tests/product-alignment.test.mjs — owner rulings of 2026-11-19 (later): the public product pictures are the owner's OWN designs, never the old stock photos, and /products/ is
// ALIGNED with /catalogue/ (same order, same group names, same "From ₱N + VAT" / "Priced per project" per product).
//
//   · NO old stock photo is named anywhere public (pages, catalogue, JSON-LD, css/js, llms.txt, sitemap, the photo map, the family file); every product picture on the site is one
//     of the eleven design images, a card or page with no design shows no picture at all;
//   · a caption is exactly "Representative image"; no alt text, caption, title or file name says how a picture was made (AI, generated, render, ChatGPT ...); alt text is the product name;
//   · the catalogue's project cards may name an image path of their own (loadProjectImages): validated like the photo map;
//   · each hub card and each of the eleven product pages carries ONE starting-price line, equal to scripts/public-from-prices.json and to the catalogue card; the hub lists the eleven in
//     the catalogue's order under the catalogue's own group headings; scripts/check-catalogue-cards.js (CHECK 9) fails on a drifted page.
// Mutation-checked: one product page's amount changed in a scratch copy (see the last test), the hub order swapped, a stock photo named in a page.
// Run with: node --test tests/product-alignment.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// the old stock photos (owner: wrong pictures) and the owner's own design images
const STOCK = ['commercial-gas-rice-steamer', 'countertop-gas-charbroiler', 'countertop-gas-cooking-range', 'countertop-gas-flat-griddle', 'countertop-single-tank-gas-fryer', 'gas-upright-split-tank-fryer', 'open-gas-range-4-burner-no-stand',
  'square-louvered-diffusers', 'stainless-gas-range-with-static-oven', 'stainless-steel-1-bowl-sinktable-with-backsplash', 'stainless-steel-4-tier-slotted-racks', 'stainless-steel-ducting', 'stainless-steel-island-type-worktable-with-mid-and-bottom-shelf',
  'stainless-steel-mobile-baking-pan-trolley', 'stainless-steel-potwash-sinktable-with-backsplash', 'stainless-steel-range-hood', 'stainless-steel-sink-with-backsplash', 'stainless-steel-wall-type-worktable-with-mid-and-bottom-shelf-with-backsplash',
  'stock-pot-gas-range', 'undercounter-door-worktable-chiller', 'undercounter-worktable-freezer', 'wall-shelf-w-backsplash'];
// every product picture is one of the owner's design images, saved as render-NN-<slug>.webp (1200 px, with a 600 px -thumb); the ones this work needs are listed
const DESIGNS = ['render-03-straight-table-152-two-shelves', 'render-02-straight-table-122-backsplash-shelf', 'render-15-commercial-station-183-cabinet-trash', 'render-44-two-bowl-dishwashing-sink', 'render-50-general-utility-sink', 'render-61-rear-pitch-hood-300',
  'render-74-exhaust-and-fresh-air-cutaway', 'render-78-welded-black-iron-grease-duct', 'render-77-duct-fiberglass-insulation', 'render-80-ceiling-fresh-air-diffusers', 'render-20-commercial-station-244-four-cabinets'];
const IS_DESIGN = (slug) => /^render-\d\d-[a-z0-9-]+$/.test(slug);
// the two stock files kept on disk ONLY because scripts/downloads/catalogue.js (the PDF builder) still names them (the committed PDF is not regenerated yet): no public page may use them
const KEPT_FOR_PDF = ['stainless-steel-ducting', 'square-louvered-diffusers'];

const walk = (dir, out = []) => { for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) { const rel = path.posix.join(dir, e.name); if (e.isDirectory()) walk(rel, out); else out.push(rel); } return out; };
const PUBLIC_DIRS = ['products', 'services', 'work', 'areas-we-serve', 'faq', 'guides', 'catalogue'];
const PUBLIC_FILES = [...PUBLIC_DIRS.flatMap((d) => walk(d)).filter((f) => /\.html$/.test(f)), 'index.html', '404.html', 'llms.txt', 'sitemap.xml', 'js/site.js', 'js/catalogue.js', 'css/site.css', 'css/pages.css', 'css/catalogue.css', 'css/guides.css',
  'scripts/product-photos.json', 'scripts/public-families.json', 'scripts/catalogue-cards.js', 'scripts/public-categories.json'].filter(exists);

describe('the owner\'s designs replace the stock photos', () => {
  it('names no stock photo anywhere public, and no page or card uses an image outside the owner\'s design images (render-NN-*)', () => {
    for (const f of PUBLIC_FILES) {
      const t = read(f);
      for (const slug of STOCK) assert.ok(!new RegExp(`site/img/products/${slug}(-thumb)?\\.webp`).test(t), `${f} names the stock photo ${slug}`);
      for (const m of t.matchAll(/site\/img\/products\/([a-z0-9-]+?)(?:-thumb)?\.webp/g)) assert.ok(IS_DESIGN(m[1]) && exists(`site/img/products/${m[1]}.webp`), `${f}: ${m[0]} is not one of the owner's design images`);
    }
  });

  it('keeps on disk only the design images (render-NN-*, each with its -thumb, 1200 and 600 px wide) and the two files the PDF builder still names', () => {
    const files = fs.readdirSync(path.join(ROOT, 'site/img/products')).sort();
    const designFiles = files.filter((x) => /^render-\d\d-/.test(x));
    assert.deepEqual(files.filter((x) => !/^render-\d\d-/.test(x)), KEPT_FOR_PDF.flatMap((d) => [`${d}-thumb.webp`, `${d}.webp`]).sort());
    for (const d of DESIGNS) assert.ok(files.includes(`${d}.webp`) && files.includes(`${d}-thumb.webp`), d);
    assert.ok(designFiles.every((x) => /^render-\d\d-[a-z0-9-]+(-thumb)?\.webp$/.test(x)));
    const { webpSize } = require('../scripts/build-catalogue.js');
    for (const d of DESIGNS) {
      assert.equal(webpSize(fs.readFileSync(path.join(ROOT, `site/img/products/${d}.webp`))).width, 1200, d);
      assert.equal(webpSize(fs.readFileSync(path.join(ROOT, `site/img/products/${d}-thumb.webp`))).width, 600, d);
    }
    for (const k of KEPT_FOR_PDF) assert.ok(/prod-stainless-steel-ducting|prod-square-louvered-diffusers/.test(read('scripts/downloads/catalogue.js')) && read('scripts/downloads/catalogue.js').includes(k), `${k}: kept for the PDF builder, which no longer names it`);
  });

  it('maps only the four designs a family card shows (preparation table, sink, range hood, cabinet) and gives the two project cards their own image path; every other card has no photo', () => {
    assert.deepEqual(JSON.parse(read('scripts/product-photos.json')), {
      'PW-003': 'site/img/products/render-03-straight-table-152-two-shelves.webp', 'PW-008': 'site/img/products/render-44-two-bowl-dishwashing-sink.webp',
      'PW-015': 'site/img/products/render-20-commercial-station-244-four-cabinets.webp', 'EX-001': 'site/img/products/render-61-rear-pitch-hood-300.webp' });
    const fams = JSON.parse(read('scripts/public-families.json')).families;
    assert.deepEqual(Object.entries(fams).filter(([, f]) => f.photo).map(([k, f]) => [k, f.photo]), [['prep_table', 'PW-003'], ['sink', 'PW-008'], ['hood', 'EX-001'], ['cabinet', 'PW-015']]);
    const cards = require('../scripts/catalogue-cards.js').PROJECT_CARDS;
    assert.deepEqual(cards.map((c) => [c.id, c.image || null, c.photo || null]), [['station', 'site/img/products/render-15-commercial-station-183-cabinet-trash.webp', null], ['exhaust', 'site/img/products/render-74-exhaust-and-fresh-air-cutaway.webp', null],
      ['pugon', null, null], ['teppanyaki', null, null], ['inasal', null, null], ['noodle_boiler', null, null], ['combi_stove', null, null], ['trolley', null, null]]);
    const page = read('catalogue/index.html');
    const withPhoto = [...page.matchAll(/<li class="cat-card[^"]*" data-(?:family|id|ask)="([^"]+)"[^>]*>(<figure class="cat-photo">)?/g)].filter((m) => m[2]).map((m) => m[1]);
    assert.deepEqual(withPhoto, ['prep_table', 'station', 'sink', 'hood', 'exhaust', 'cabinet']);
  });
});

describe('captions and alt text', () => {
  const HOW = /\bAI\b|A\.I\.|generat(ed|ive|ion)|\brender(s|ed|ing)?\b|chatgpt|midjourney|dall-?e|stable diffusion|synthetic|artificial/i;
  const figures = (html) => [...html.matchAll(/<figure class="(?:cat-photo|pg-fig)">[\s\S]*?<\/figure>/g)].map((m) => m[0]).filter((f) => /site\/img\/products\//.test(f));

  it('every product picture on a public page has the caption "Representative image" (and only that on the catalogue), lazy loading, and alt text that never says how it was made', () => {
    let n = 0;
    for (const f of PUBLIC_FILES.filter((x) => x.endsWith('.html'))) {
      for (const fig of figures(read(f))) {
        n++;
        assert.ok(fig.includes('Representative image'), `${f}: a product picture without the caption`);
        if (fig.includes('cat-photo')) assert.ok(fig.includes('<figcaption>Representative image</figcaption>'), `${f}: the catalogue caption is not exactly "Representative image"`);
        else assert.ok(fig.includes('<span>Representative image</span></figcaption>'), `${f}: the caption span`);
        assert.ok(fig.includes('loading="lazy"'), `${f}: not lazy`);
        const alt = decode((fig.match(/alt="([^"]+)"/) || [])[1] || '');
        assert.ok(alt.length > 3 && !HOW.test(alt) && !HOW.test(fig.replace(/<img[^>]*>/, '')), `${f}: alt or caption: "${alt}"`);
      }
    }
    assert.ok(n >= 6 + 2 + 2 + 1 + 3 + 3 + 1, `only ${n} product pictures found`);
  });

  it('the catalogue figure\'s alt text is its card\'s name; no file name, comment or metadata field of a product picture names the tool', () => {
    const page = read('catalogue/index.html');
    for (const m of page.matchAll(/<li class="cat-card[^"]*"[^>]*>(<figure class="cat-photo"><img [^>]*alt="([^"]+)"[\s\S]*?<\/figure>)[\s\S]*?<h3>([^<]+)<\/h3>/g)) assert.equal(decode(m[2]), decode(m[3]), 'alt != card name');
    for (const f of fs.readdirSync(path.join(ROOT, 'site/img/products'))) {
      assert.ok(!HOW.test(f.replace(/^render-\d\d-/, '')), `file name ${f}`);   // the origin's own naming convention render-NN-<slug> is the one allowed use of the word
      const xmp = (fs.readFileSync(path.join(ROOT, 'site/img/products', f)).toString('utf8').match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/) || [''])[0];   // the XMP packet scripts/watermark-images.py writes
      assert.ok(!HOW.test(xmp), `${f}: embedded metadata names how it was made`);
      if (DESIGNS.some((d) => f.startsWith(d))) assert.ok(/barroindustries\.com\/#copyright/.test(xmp), `${f}: no copyright metadata`);
    }
    for (const f of ['scripts/product-photos.json', 'scripts/catalogue-cards.js']) assert.ok(!HOW.test(read(f).replace(/render-\d\d-/g, '')), f);
  });
});

describe('loadProjectImages (a project card names its own image path)', () => {
  const { loadProjectImages } = require('../scripts/build-catalogue.js');
  const scratch = (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-'));
    fs.mkdirSync(path.join(root, 'site/img/products'), { recursive: true });
    for (const f of files) fs.copyFileSync(path.join(ROOT, 'site/img/products', f), path.join(root, 'site/img/products', f));
    return root;
  };
  it('accepts the real design images and returns the same shape as the photo map', () => {
    const { images } = loadProjectImages({ cards: require('../scripts/catalogue-cards.js').PROJECT_CARDS });
    assert.deepEqual(images.station, { src: 'site/img/products/render-15-commercial-station-183-cabinet-trash.webp', thumb: 'site/img/products/render-15-commercial-station-183-cabinet-trash-thumb.webp', width: 600, height: 307, mainWidth: 1200 });
    assert.deepEqual(Object.keys(images).sort(), ['exhaust', 'station']);
  });
  it('refuses a bad path, a -thumb path, a missing thumb and a file that is not WebP — one aggregated error', () => {
    const ok = 'render-15-commercial-station-183-cabinet-trash';
    const root = scratch([`${ok}.webp`, `${ok}-thumb.webp`]);
    fs.writeFileSync(path.join(root, 'site/img/products/fake.webp'), 'not a webp');
    fs.writeFileSync(path.join(root, 'site/img/products/fake-thumb.webp'), 'not a webp');
    fs.copyFileSync(path.join(ROOT, `site/img/products/${ok}.webp`), path.join(root, 'site/img/products/lonely.webp'));
    const cards = [{ id: 'a', image: '../x.webp' }, { id: 'b', image: `site/img/products/${ok}-thumb.webp` }, { id: 'c', image: 'site/img/products/lonely.webp' }, { id: 'd', image: 'site/img/products/fake.webp' }, { id: 'e', image: 42 }, { id: 'f', image: `site/img/products/${ok}.webp` }, { id: 'g' }];
    assert.throws(() => loadProjectImages({ cards, root }), (e) => /5 image problem/.test(e.message) && /a: image must look like/.test(e.message) && /c: missing file/.test(e.message) && /d: .*not a readable WebP/.test(e.message) && !/f:/.test(e.message) && !/g:/.test(e.message));
    assert.deepEqual(Object.keys(loadProjectImages({ cards: [cards[5], cards[6]], root }).images), ['f']);
  });
});

describe('/products/ is aligned with /catalogue/', () => {
  const prices = JSON.parse(read('scripts/public-from-prices.json')).prices;
  const line = (e) => (e.perProject ? '<p class="cat-from cat-from-ask">Priced per project</p>' : `<p class="cat-from">From <data value="${e.from}">₱${String(e.from).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</data> <span class="cat-vat">+ VAT</span></p>`);
  const ORDER = [['prep_table', 'stainless-steel-work-tables', 'Preparation tables'], ['sink', 'stainless-steel-sinks', 'Sinks and dish tables'], ['dish_table', 'stainless-steel-dish-tables', 'Sinks and dish tables'], ['hood', 'stainless-steel-range-hoods', 'Range hoods'],
    ['stove', 'commercial-gas-stoves', 'Chef Mode cooking equipment'], ['wok_range', 'commercial-wok-ranges', 'Chef Mode cooking equipment'], ['cooking_line', 'commercial-griddles-grillers-and-fryers', 'Chef Mode cooking equipment'], ['deck_oven', 'gas-deck-ovens', 'Chef Mode cooking equipment'],
    ['cabinet', 'stainless-steel-cabinets', 'Storage, racks and trolleys'], ['wall_shelf', 'stainless-steel-shelving', 'Storage, racks and trolleys'], ['rack', 'stainless-steel-racks', 'Storage, racks and trolleys']];
  const cat = read('catalogue/index.html');
  const hub = read('products/index.html');

  it('lists the eleven products in the catalogue\'s order, each tagged with the catalogue\'s own group heading', () => {
    const catOrder = [...cat.matchAll(/data-family="([a-z_]+)"/g)].map((m) => m[1]).filter((f, i, a) => a.indexOf(f) === i);
    assert.deepEqual(catOrder, ORDER.map((o) => o[0]), 'the catalogue\'s own family order changed: align /products/ and this test');
    const headings = [...cat.matchAll(/<h2 id="cat-h-[a-z]+">([^<]*?)\s*</g)].map((m) => decode(m[1]));
    for (const g of new Set(ORDER.map((o) => o[2]))) assert.ok(headings.includes(g), `the catalogue has no group "${g}"`);
    const cards = [...hub.matchAll(/<p class="pg-card-tag">([^<]+)<\/p>\s*<h3><a href="\/products\/([a-z-]+)\/">/g)].map((m) => [m[2], decode(m[1])]);
    assert.deepEqual(cards, ORDER.map((o) => [o[1], o[2]]));
  });

  it('links the eight catalogue groups, by their current labels and anchors', () => {
    const chips = hub.match(/<div class="pg-chips">[\s\S]*?<\/div>/)[0];
    const links = [...chips.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
    const real = [...cat.matchAll(/<h2 id="cat-h-([a-z]+)">([^<]*?)\s*</g)].map((m) => [`/catalogue/#cat-${m[1]}`, decode(m[2])]);
    assert.deepEqual(links, [...real, ['/catalogue/', 'The whole catalogue']]);
  });

  it('shows on every hub card and every product page the same starting price as its catalogue card: the JSON value, in the catalogue\'s exact element', () => {
    for (const [fam, slug] of ORDER) {
      const e = prices[fam];
      assert.ok(e && (e.perProject || Number.isInteger(e.from)), fam);
      const want = line(e);
      const card = cat.match(new RegExp(`<li class="cat-card cat-card-family[^"]*" data-family="${fam}"[\\s\\S]*?</li>(?=\\n<li class="cat-card|\\n</ul>)`))[0];
      assert.ok(card.includes(want), `${fam}: the catalogue card`);
      const page = read(`products/${slug}/index.html`);
      assert.equal((page.match(/<p class="cat-from[ "]/g) || []).length, 1, `${slug}: exactly one price line`);
      assert.ok(page.includes(want), `${slug}: its price line is not the catalogue card's`);
      const hubCard = hub.match(new RegExp(`<article class="pg-card">(?:(?!</article>)[\\s\\S])*?href="/products/${slug}/"[\\s\\S]*?</article>`))[0];
      assert.equal((hubCard.match(/<p class="cat-from[ "]/g) || []).length, 1, `${slug}: hub card has one price line`);
      assert.ok(hubCard.includes(want), `${slug}: the hub card's price line`);
    }
    assert.equal((hub.match(/<p class="cat-from[ "]/g) || []).length, 11);
  });

  it('puts the amount nowhere else on /products/ and its pages (the estimate sentence stays as it was)', () => {
    for (const f of ['products/index.html', ...ORDER.map((o) => `products/${o[1]}/index.html`)]) {
      const t = read(f).replace(/<style id="page-css">[\s\S]*?<\/style>/, '').replace(/<p class="cat-from[ "][^>]*>.*?<\/p>/g, '');
      assert.ok(!/₱|\bPHP ?[0-9]|\b[0-9]{1,3}(,[0-9]{3})+\b(?!\.)/.test(t.replace(/fonts\.googleapis\.com[^"']*/g, '')), `${f}: money outside the price line`);
      assert.ok(t.includes('Prices depend on size and options.'), `${f}: the owner's sentence`);
    }
    for (const f of ['index.html', 'services/index.html', 'work/index.html', 'faq/index.html', 'areas-we-serve/index.html', 'guides/index.html', 'services/fresh-air-systems/index.html', 'services/exhaust-and-fresh-air-systems/index.html'])
      assert.ok(!/<p class="cat-from|₱/.test(read(f).replace(/<style id="(?:page|site)-css">[\s\S]*?<\/style>/, '')), `${f}: a price on a page that stays price-free`);
  });

  it('scripts/check-catalogue-cards.js passes on the repo and FAILS (naming the page, never the amount) on a scratch copy with a drifted price, a swapped hub order and a wrong group tag', () => {
    const run = (root) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-catalogue-cards.js'), root], { encoding: 'utf8' });
    assert.equal(run(ROOT).stdout, '', 'the repo itself must pass');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mut-'));
    const copy = (rel) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel)); };
    for (const rel of ['catalogue/index.html', 'products/index.html', 'scripts/public-from-prices.json', ...ORDER.map((o) => `products/${o[1]}/index.html`)]) copy(rel);
    assert.equal(run(root).stdout, '');
    const edit = (rel, fn) => { const p = path.join(root, rel); const before = fs.readFileSync(p, 'utf8'); fs.writeFileSync(p, fn(before)); return () => fs.writeFileSync(p, before); };
    // 1. a product page's amount differs from the catalogue
    let undo = edit('products/stainless-steel-sinks/index.html', (t) => t.replace('<data value="20500">₱20,500</data>', '<data value="20600">₱20,600</data>'));
    let out = run(root).stdout;
    assert.ok(/stainless-steel-sinks\/index\.html: its price line/.test(out) && !/20,?[56]00/.test(out), out);
    undo();
    // 2. a hub card says "Priced per project" for a product that has an amount
    undo = edit('products/index.html', (t) => t.replace('<p class="cat-from">From <data value="14000">₱14,000</data> <span class="cat-vat">+ VAT</span></p>', '<p class="cat-from cat-from-ask">Priced per project</p>'));
    out = run(root).stdout;
    assert.ok(/products\/index\.html: the wall_shelf card/.test(out), out);
    undo();
    // 3. the hub order drifts from the catalogue's (the first two cards swapped)
    undo = edit('products/index.html', (t) => { const a = t.indexOf('      <article class="pg-card">'); const b = t.indexOf('      <article class="pg-card">', a + 10); const c = t.indexOf('      <article class="pg-card">', b + 10); return t.slice(0, a) + t.slice(b, c) + t.slice(a, b) + t.slice(c); });
    out = run(root).stdout;
    assert.ok(/not in the catalogue's order/.test(out), out);
    undo();
    // 4. a group tag that is not the catalogue's heading
    undo = edit('products/index.html', (t) => t.replace('<p class="pg-card-tag">Range hoods</p>', '<p class="pg-card-tag">Ventilation</p>'));
    out = run(root).stdout;
    assert.ok(/the hood card's group tag/.test(out), out);
    undo();
    assert.equal(run(root).stdout, '');
  });
});
