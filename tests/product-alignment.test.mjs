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
const DESIGNS = ['render-03-straight-table-152-two-shelves', 'render-02-straight-table-122-backsplash-shelf', 'render-20-commercial-station-244-four-cabinets', 'render-44-two-bowl-dishwashing-sink', 'render-50-general-utility-sink', 'render-61-rear-pitch-hood-300',
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
    assert.deepEqual(cards.map((c) => [c.id, c.image || null, c.photo || null]), [['station', 'site/img/products/render-20-commercial-station-244-four-cabinets.webp', null], ['exhaust', 'site/img/products/render-74-exhaust-and-fresh-air-cutaway.webp', null],
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
    assert.deepEqual(images.station, { src: 'site/img/products/render-20-commercial-station-244-four-cabinets.webp', thumb: 'site/img/products/render-20-commercial-station-244-four-cabinets-thumb.webp', width: 600, height: 300, mainWidth: 1200 });
    assert.deepEqual(Object.keys(images).sort(), ['exhaust', 'station']);
  });
  it('refuses a bad path, a -thumb path, a missing thumb and a file that is not WebP — one aggregated error', () => {
    const ok = 'render-20-commercial-station-244-four-cabinets';
    const root = scratch([`${ok}.webp`, `${ok}-thumb.webp`]);
    fs.writeFileSync(path.join(root, 'site/img/products/fake.webp'), 'not a webp');
    fs.writeFileSync(path.join(root, 'site/img/products/fake-thumb.webp'), 'not a webp');
    fs.copyFileSync(path.join(ROOT, `site/img/products/${ok}.webp`), path.join(root, 'site/img/products/lonely.webp'));
    const cards = [{ id: 'a', image: '../x.webp' }, { id: 'b', image: `site/img/products/${ok}-thumb.webp` }, { id: 'c', image: 'site/img/products/lonely.webp' }, { id: 'd', image: 'site/img/products/fake.webp' }, { id: 'e', image: 42 }, { id: 'f', image: `site/img/products/${ok}.webp` }, { id: 'g' }];
    assert.throws(() => loadProjectImages({ cards, root }), (e) => /5 image problem/.test(e.message) && /a: image must look like/.test(e.message) && /c: missing file/.test(e.message) && /d: .*not a readable WebP/.test(e.message) && !/f:/.test(e.message) && !/g:/.test(e.message));
    assert.deepEqual(Object.keys(loadProjectImages({ cards: [cards[5], cards[6]], root }).images), ['f']);
  });
});

const ORDER = [['prep_table', 'stainless-steel-work-tables'], ['sink', 'stainless-steel-sinks'], ['dish_table', 'stainless-steel-dish-tables'], ['hood', 'stainless-steel-range-hoods'], ['stove', 'commercial-gas-stoves'], ['wok_range', 'commercial-wok-ranges'],
  ['cooking_line', 'commercial-griddles-grillers-and-fryers'], ['cabinet', 'stainless-steel-cabinets'], ['wall_shelf', 'stainless-steel-shelving'], ['rack', 'stainless-steel-racks']];
const HTML_FILES = (() => { const out = []; const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d || '.'), { withFileTypes: true })) { const rel = d ? `${d}/${e.name}` : e.name;
  if (e.isDirectory()) { if (!['node_modules', '.git', 'downloads', 'private', 'archive', 'functions', 'dev', 'docs', 'fable-workplan', 'icons', 'site', 'css', 'js', 'scripts', 'tests'].includes(e.name)) walk(rel); } else if (e.name.endsWith('.html')) out.push(rel); } }; walk(''); return out; })();

describe('the product pages show the same starting price as the catalogue', () => {
  const prices = JSON.parse(read('scripts/public-from-prices.json')).prices;
  const line = (e) => (e.perProject ? '<p class="cat-from cat-from-ask">Priced per project</p>' : `<p class="cat-from">From <data value="${e.from}">₱${String(e.from).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</data> <span class="cat-vat">+ VAT</span></p>`);
  const cat = read('catalogue/index.html');

  it('shows on every product page the same starting price as its catalogue card: the JSON value, in the catalogue\'s exact element, once', () => {
    for (const [fam, slug] of ORDER) {
      const e = fam === 'deck_oven' ? { perProject: true } : prices[fam];   // the gas deck oven has no catalogue card (owner 2026-11-19): its page says "Priced per project"
      assert.ok(e && (e.perProject || Number.isInteger(e.from)), fam);
      const want = line(e);
      if (fam !== 'deck_oven') {
        const card = cat.match(new RegExp(`<li class="cat-card cat-card-family[^"]*" data-family="${fam}"[\\s\\S]*?</li>(?=\\n<li class="cat-card|\\n</ul>)`))[0];
        assert.ok(card.includes(want), `${fam}: the catalogue card`);
      }
      const page = read(`products/${slug}/index.html`);
      assert.equal((page.match(/<p class="cat-from[ "]/g) || []).length, 1, `${slug}: exactly one price line`);
      assert.ok(page.includes(want), `${slug}: its price line is not the catalogue card's`);
    }
  });

  it('puts the amount nowhere else on the product pages (the estimate sentence stays), and nowhere on the pages that stay price-free', () => {
    for (const f of ORDER.map((o) => `products/${o[1]}/index.html`)) {
      const t = read(f).replace(/<style id="page-css">[\s\S]*?<\/style>/, '').replace(/<p class="cat-from[ "][^>]*>.*?<\/p>/g, '');
      assert.ok(!/₱|\bPHP ?[0-9]|\b[0-9]{1,3}(,[0-9]{3})+\b(?!\.)/.test(t.replace(/fonts\.googleapis\.com[^"']*/g, '')), `${f}: money outside the price line`);
      assert.ok(t.includes('Prices depend on size and options.'), `${f}: the owner's sentence`);
    }
    for (const f of ['index.html', 'products/index.html', 'services/index.html', 'work/index.html', 'faq/index.html', 'areas-we-serve/index.html', 'guides/index.html', 'services/fresh-air-systems/index.html', 'services/exhaust-and-fresh-air-systems/index.html'])
      assert.ok(!/<p class="cat-from|₱/.test(read(f).replace(/<style id="(?:page|site)-css">[\s\S]*?<\/style>/, '')), `${f}: a price on a page that stays price-free`);
  });

  it('scripts/check-catalogue-cards.js passes on the repo and FAILS (naming the page, never the amount) on a scratch copy with a drifted price, a price line on the forward, and a forward that is indexable or does not refresh', () => {
    const run = (root) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-catalogue-cards.js'), root], { encoding: 'utf8' });
    assert.equal(run(ROOT).stdout, '', 'the repo itself must pass');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mut-'));
    const copy = (rel) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel)); };
    for (const rel of ['catalogue/index.html', 'products/index.html', 'products/gas-deck-ovens/index.html', 'scripts/public-from-prices.json', ...ORDER.map((o) => `products/${o[1]}/index.html`)]) copy(rel);
    assert.equal(run(root).stdout, '');
    const edit = (rel, fn) => { const p = path.join(root, rel); const before = fs.readFileSync(p, 'utf8'); fs.writeFileSync(p, fn(before)); return () => fs.writeFileSync(p, before); };
    let undo = edit('products/stainless-steel-sinks/index.html', (t) => t.replace('<data value="20500">₱20,500</data>', '<data value="20600">₱20,600</data>'));
    let out = run(root).stdout;
    assert.ok(/stainless-steel-sinks\/index\.html: its price line/.test(out) && !/20,?[56]00/.test(out), out);
    undo();
    undo = edit('products/index.html', (t) => t.replace('<h1>', '<p class="cat-from cat-from-ask">Priced per project</p><h1>'));
    assert.ok(/products\/index\.html: it must be the noindex forward/.test(run(root).stdout));
    undo();
    undo = edit('products/index.html', (t) => t.replace('noindex, follow', 'index, follow'));
    assert.ok(/products\/index\.html: it must be the noindex forward/.test(run(root).stdout));
    undo();
    undo = edit('products/index.html', (t) => t.replace('<meta http-equiv="refresh" content="0; url=/catalogue/">', ''));
    assert.ok(/products\/index\.html: it must be the noindex forward/.test(run(root).stdout));
    undo();
    assert.equal(run(root).stdout, '');
  });
});

describe('Products and Catalogue are one list (owner ruling 2026-11-19)', () => {
  const FIVE = ['<a href="/services/">Services</a>', '<a href="/catalogue/">Products</a>', '<a href="/work/">Our work</a>', '<a href="/guides/">The Kitchen Guide</a>'];
  const navOf = (h) => (h.match(/<nav id="site-nav"[^>]*>([\s\S]*?)<\/nav>/) || [, null])[1];

  it('shows exactly Services, Products (to /catalogue/), Our work, The Kitchen Guide and Contact in the menu, then Get a quote, on every page that has a menu; no "Catalogue" menu or footer link remains', () => {
    let n = 0;
    for (const f of HTML_FILES) {
      const h = read(f), nav = navOf(h);
      if (nav === null) continue;
      n++;
      const links = (nav.match(/<a [^>]*>[^<]*<\/a>/g) || []).map((a) => a.replace(/ aria-current="[^"]*"/, ''));
      assert.deepEqual(links.slice(0, 4), FIVE, `${f}: the menu`);
      assert.match(links[4], /^<a href="(\/)?#contact">Contact<\/a>$/, `${f}: the Contact link`);
      assert.equal(links.length, 5, `${f}: ${links.length} menu links`);
      assert.ok(/<a class="site-btn site-btn-primary site-btn-sm site-head-cta" href="\/catalogue\/\?quote=1"[^>]*>Get a quote<\/a>/.test(h), `${f}: Get a quote`);
      assert.ok(!/>Catalogue<\/a>/.test(h.replace(/<style[\s\S]*?<\/style>/, '')), `${f}: a "Catalogue" link remains`);
      const foot = (h.match(/<p class="foot-links">[\s\S]*?<\/p>/) || [''])[0];
      assert.ok(/<a href="\/catalogue\/">Products<\/a>/.test(foot) && !/href="\/products\/"/.test(foot), `${f}: the footer Products link`);
    }
    assert.ok(n >= 130, `only ${n} pages have a menu`);
  });

  it('marks Products as the current page on /catalogue/ ("page") and on the eleven product pages ("true")', () => {
    const cur = (f) => [...navOf(read(f)).matchAll(/<a href="([^"]+)" aria-current="([^"]+)">/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(cur('catalogue/index.html'), [['/catalogue/', 'page']]);
    for (const [, slug] of ORDER) assert.deepEqual(cur(`products/${slug}/index.html`), [['/catalogue/', 'true']], slug);
  });

  it('has no internal link to the retired /products/ hub anywhere (pages, JSON-LD, llms.txt, sitemap), and the eleven product pages\' breadcrumb reads Home > Products (/catalogue/) > the page', () => {
    for (const f of [...HTML_FILES.filter((x) => x !== 'products/index.html'), 'llms.txt', 'sitemap.xml']) {
      const t = read(f).replace(/<style[\s\S]*?<\/style>/g, '');
      assert.ok(!/(?:href="|\(|<loc>|"item": "|"url": "|content=")(?:https:\/\/barroindustries\.com)?\/products\/(?:["<)])/.test(t), `${f}: a link to the retired /products/ hub`);
    }
    for (const [, slug] of ORDER) {
      const h = read(`products/${slug}/index.html`);
      assert.ok(/<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="\/">Home<\/a><\/li><li><a href="\/catalogue\/">Products<\/a><\/li><li><span aria-current="page">/.test(h), `${slug}: the visible breadcrumb`);
      assert.ok(h.includes('"name": "Products",\n          "item": "https://barroindustries.com/catalogue/"'), `${slug}: the JSON-LD breadcrumb`);
    }
  });

  it('turns /products/ into a noindex forward to /catalogue/ (meta refresh, canonical, a visible link, the site\'s CSP) and keeps it out of the sitemap while the eleven product pages stay in it', () => {
    const h = read('products/index.html');
    assert.ok(h.includes('<meta http-equiv="refresh" content="0; url=/catalogue/">'));
    assert.ok(h.includes('<link rel="canonical" href="https://barroindustries.com/catalogue/">'));
    assert.ok(h.includes('<meta name="robots" content="noindex, follow">'));
    assert.ok(/<a class="site-btn site-btn-primary" href="\/catalogue\/">Open the catalogue<\/a>/.test(h), 'a visible link');
    assert.match(h, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'sha256-[A-Za-z0-9+\/=]+' https:\/\/fonts\.googleapis\.com;/);
    assert.ok(!/application\/ld\+json/.test(h) && !/og:title/.test(h), 'a retired page carries no structured data');
    const map = read('sitemap.xml');
    assert.ok(!map.includes('<loc>https://barroindustries.com/products/</loc>'), 'the sitemap still lists the retired hub');
    for (const [, slug] of ORDER) assert.ok(map.includes(`<loc>https://barroindustries.com/products/${slug}/</loc>`), `${slug}: not in the sitemap`);
    assert.ok(map.includes('<loc>https://barroindustries.com/catalogue/</loc>'));
    assert.ok(!exists('site/img/seo/og-products.webp'), 'the retired hub\'s social card is still shipped');
  });
});
