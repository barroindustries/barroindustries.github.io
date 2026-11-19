'use strict';
// scripts/check-catalogue-cards.js — ci-invariants CHECK 9 helper (owner ruling 2026-11-19): every catalogue card is text plus at most its captioned product photo (no drawing or tile) and carries
// EXACTLY ONE price line, which is the generator's exact form and agrees with scripts/public-from-prices.json. Prints one problem per line (never an amount); no output = pass.
// Since owner ruling 2026-11-19 (later) it also pins /products/ and its eleven product pages to the catalogue: each page carries ONE starting-price line and each hub card ONE, every one
// equal to scripts/public-from-prices.json (so equal to the catalogue card); the hub lists the eleven in the catalogue's order, tagged with the catalogue's own group heading.
// Usage: node scripts/check-catalogue-cards.js [repo root]   (default: the current directory; the tests run it on a scratch copy to prove it fails).
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || '.';
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const out = [];
const FAMILY_PAGE = { prep_table: 'stainless-steel-work-tables', sink: 'stainless-steel-sinks', dish_table: 'stainless-steel-dish-tables', hood: 'stainless-steel-range-hoods', stove: 'commercial-gas-stoves', wok_range: 'commercial-wok-ranges',
  cooking_line: 'commercial-griddles-grillers-and-fryers', deck_oven: 'gas-deck-ovens', cabinet: 'stainless-steel-cabinets', wall_shelf: 'stainless-steel-shelving', rack: 'stainless-steel-racks' };
const wantLine = (e) => e.perProject ? '<p class="cat-from cat-from-ask">Priced per project</p>'
  : '<p class="cat-from">From <data value="' + e.from + '">\u20B1' + String(e.from).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '</data> <span class="cat-vat">+ VAT</span></p>';
try {
  const page = rd('catalogue/index.html');
  const a = page.indexOf('<!-- CATALOGUE:START'), b = page.indexOf('<!-- CATALOGUE:END -->');
  const block = page.slice(a, b);
  // the product photo is back (owner 2026-11-19 later): only the exact captioned figure, first in its card; never a tile or a drawing
  const bare = block.replace(/<figure class="cat-photo"><img src="\/site\/img\/products\/[a-z0-9-]+-thumb\.webp" [^>]*><figcaption>Representative image<\/figcaption><\/figure>/g, '');
  if (/<img\b|<figure\b|class="cat-(photo|tile)"/.test(bare)) out.push('the catalogue block carries an image, figure or tile other than the captioned product photo');
  const prices = JSON.parse(rd('scripts/public-from-prices.json')).prices;
  const cards = block.split('<li class="cat-card').slice(1);
  const seen = new Set();
  cards.forEach((c, i) => {
    const key = (c.match(/data-(?:family|id|ask)="([^"]+)"/) || [])[1];
    const lines = c.match(/<p class="cat-from[ "][^>]*>/g) || [];
    if (!key) { out.push('card #' + (i + 1) + ' has no data-family / data-id / data-ask'); return; }
    seen.add(key);
    if (lines.length !== 1) { out.push(key + ': ' + lines.length + ' price lines (exactly one is required)'); return; }
    const e = prices[key];
    if (!e) { out.push(key + ': no entry in scripts/public-from-prices.json'); return; }
    const want = wantLine(e);
    if (!c.includes(want)) out.push(key + ': its price line is not the one in scripts/public-from-prices.json');
  });
  Object.keys(prices).forEach(k => { if (!seen.has(k)) out.push(k + ': in scripts/public-from-prices.json but not a card of the page'); });

  // ── /products/ and its eleven pages: the same starting price as the catalogue card, the same order, the same group names ──
  const famOrder = [], groupOf = {};                                   // the catalogue's own order of the eleven families, and the heading of the group each sits in
  for (const g of block.split('<section class="cat-group"').slice(1)) {
    const heading = ((g.match(/<h2 id="cat-h-[a-z]+">([^<]*?)\s*</) || [])[1] || '').trim();
    for (const m of g.matchAll(/<li class="cat-card cat-card-family[^"]*" data-family="([a-z_]+)"/g)) { famOrder.push(m[1]); groupOf[m[1]] = heading; }
  }
  const slugOrder = famOrder.map(f => FAMILY_PAGE[f]);
  if (famOrder.length !== 11 || famOrder.some(f => !FAMILY_PAGE[f])) out.push('the catalogue does not show the eleven product families');
  const hub = rd('products/index.html');
  const hubCards = [...hub.matchAll(/<article class="pg-card">([\s\S]*?)<\/article>/g)].map(m => m[1]).filter(c => /href="\/products\/[a-z-]+\/"/.test(c));
  const hubOrder = hubCards.map(c => (c.match(/href="\/products\/([a-z-]+)\/"/) || [])[1]);
  if (JSON.stringify(hubOrder) !== JSON.stringify(slugOrder)) out.push('products/index.html: the product cards are not in the catalogue\'s order');
  for (const fam of famOrder) {
    const slug = FAMILY_PAGE[fam], e = prices[fam];
    if (!e) { out.push(fam + ': no entry in scripts/public-from-prices.json'); continue; }
    const want = wantLine(e);
    const card = hubCards.find(c => c.includes('href="/products/' + slug + '/"')) || '';
    const cardLines = card.match(/<p class="cat-from[ "][^>]*>/g) || [];
    if (cardLines.length !== 1 || !card.includes(want)) out.push('products/index.html: the ' + fam + ' card\'s price line is not the catalogue card\'s (' + cardLines.length + ' price line(s))');
    const tag = (card.match(/<p class="pg-card-tag">([^<]*)<\/p>/) || [])[1];
    if (tag !== groupOf[fam]) out.push('products/index.html: the ' + fam + ' card\'s group tag is not the catalogue\'s group heading');
    let pg = '';
    try { pg = rd('products/' + slug + '/index.html'); } catch (_) { out.push('products/' + slug + '/index.html is missing'); continue; }
    const pgLines = pg.match(/<p class="cat-from[ "][^>]*>/g) || [];
    if (pgLines.length !== 1 || !pg.includes(want)) out.push('products/' + slug + '/index.html: its price line is not the catalogue card\'s (' + pgLines.length + ' price line(s))');
  }
  if ((hub.match(/<p class="cat-from[ "][^>]*>/g) || []).length !== 11) out.push('products/index.html: it must carry exactly eleven price lines, one per card');
} catch (e) { out.push('catalogue card check error: ' + e.message); }
out.forEach(x => console.log(x));
